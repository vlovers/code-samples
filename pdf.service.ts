import { BadRequestException, Injectable } from '@nestjs/common';
import { resolve } from 'path';
import * as puppeteer from 'puppeteer';
import { map, pick, find, forEach, reduce, orderBy } from 'lodash';

import { PdfPreviewDto } from '../dto/pdf-preview.dto';
import { defaultPageHeight, defaultPageWidth } from '../constants';
import {
  AssetPremiumPdfDataDto,
  BasicPdfDataDto,
  PdfDataDto,
  PiecePdfDataDto,
  PremiumPdfDataDto,
  PreparePdfDataResult,
} from '../dto/pattern-pdf-data.dto';
import {
  compileTemplate,
  handlebarsStylesPartial,
  handlebarsTemplates,
} from '../utils/handlebars';
import { GetCouponOrPromocodeResult, PaymentService } from './payment.service';
import { PAYMENT_AMOUNT } from '../constants/stripe';
import { PdfPaymentResult } from '../dto/payment-payload.dto';
import { PatternsService } from './patterns.service';
import { CreatePatternPieceDto } from '../dto/pattern-piece.dto';
import { FilesService } from './files.service';
import { MailService } from './mail.service';
import { SendCouponPdfDto, SendPremiumPdfDto } from '../dto/contact-info.dto';
import {
  replaceColorNames,
  replaceSvgPlaceholdersToColors,
} from '../utils/colors';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class PDFService {
  private readonly premiumPreviewPath: string;
  private readonly basicPreviewPath: string;
  private readonly premiumTemplatePath: string;
  private readonly basicTemplatePath: string;
  private readonly footerTemplatePath: string;
  private readonly stylePath: string;

  private browserInstance: puppeteer.Browser = null;
  private browserInstanceInitializedAt: Date | null = null;

  constructor(
    private readonly paymentService: PaymentService,
    private readonly patternsService: PatternsService,
    private readonly filesService: FilesService,
    private readonly mailService: MailService,
    private readonly configService: ConfigService
  ) {
    this.premiumPreviewPath = resolve(
      __dirname,
      '../assets/templates/premium-pdf-preview.hbs',
    );
    this.basicPreviewPath = resolve(
      __dirname,
      '../assets/templates/basic-pdf-preview.hbs',
    );
    this.premiumTemplatePath = resolve(
      __dirname,
      '../assets/templates/premium-pdf-template.hbs',
    );
    this.basicTemplatePath = resolve(
      __dirname,
      '../assets/templates/basic-pdf-template.hbs',
    );
    this.footerTemplatePath = resolve(
      __dirname,
      '../assets/templates/footer-template.hbs',
    );
    this.stylePath = resolve(__dirname, '../assets/templates/style.hbs');
  }

  private async cleanupStaleBrowserInstance(): Promise<void> {
    if (!this.browserInstance || !this.browserInstanceInitializedAt) {
      return;
    }

    const hourBeforeCurrentDate = new Date();
    hourBeforeCurrentDate.setHours(hourBeforeCurrentDate.getHours() - 1);

    if (this.browserInstanceInitializedAt <= hourBeforeCurrentDate) {
      await this.browserInstance.close();
      this.browserInstanceInitializedAt = null;
      this.browserInstance = null;
    }
  }

  private async getBrowserInstance(): Promise<puppeteer.Browser> {
    await this.cleanupStaleBrowserInstance();

    if (this.browserInstance) {
      return this.browserInstance;
    }

    this.browserInstance = await puppeteer.launch({
      defaultViewport: {
        width: defaultPageWidth,
        height: defaultPageHeight,
      },
      args: [
        '--disable-gpu',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--no-first-run',
        '--no-zygote'
      ],
      headless: true,
    });
    this.browserInstanceInitializedAt = new Date();

    return this.browserInstance;
  }

  public preparePatternPieces(
    patternPieces: PiecePdfDataDto[],
  ): CreatePatternPieceDto[] {
    return map(
      patternPieces,
      piece =>
        pick(piece, [
          'primaryColor',
          'secondaryColor',
          'positionX',
          'positionY',
          'rotateDeg',
          'pieceId',
          'categoryId',
        ]) as CreatePatternPieceDto,
    );
  }

  public async preparePdfData(pdfData: PdfDataDto): Promise<PreparePdfDataResult> {
    const patternPieces = map(pdfData.patternPieces, ({ piece, ...other }) => {
      const image = replaceSvgPlaceholdersToColors(piece.image, {
        primaryColor: other.primaryColor,
        secondaryColor: other.secondaryColor,
      });

      return {
        ...other,
        piece: {
          ...piece,
          image,
        },
      };
    });

    const patternAssets = await Promise.all(map(pdfData.patternAssets, async (asset) => {
      const instructions = await Promise.all(map(asset.instructions, async (instruction) => {
        const patternPiece = find(
          pdfData.patternPieces,
          ({ piece }) => piece.assetId === asset.id,
        );
        const instructionText = replaceColorNames(instruction.instructionText, {
          primaryColor: patternPiece.primaryColorName,
          secondaryColor: patternPiece.secondaryColorName,
        });

        let instructionImage;

        if (instruction.instructionImageId) {
          instructionImage = await this.filesService.getFile(instruction.instructionImageId);
        }

        return {
          ...instruction,
          instructionText,
          instructionImage: instructionImage?.url
        };
      }));

      const result = {
        ...asset,
        instructions: orderBy(instructions, "createdAt", ['asc']),
      };

      if (patternPieces) {
        (result as AssetPremiumPdfDataDto).pieces = reduce(
          patternPieces,
          (acc, { piece }) => (
            piece.assetId === asset.id ? [...acc, piece] : acc),
          [],
        );
      }

      return result;
    }));

    const materials = new Set<string>();
    forEach(
      pdfData.patternPieces,
      ({ primaryColorName, secondaryColorName }) => {
        materials.add(primaryColorName);
        secondaryColorName && materials.add(secondaryColorName);
      },
    );

    return {
      ...pdfData,
      patternAssets,
      patternPieces,
      materials,
    };
  }

  public async initializePage(template?: string): Promise<puppeteer.Page> {
    const logGroupName = 'initializePage';

    console.info(`${logGroupName} started`);
    const browser = await this.getBrowserInstance();
    const page = await browser.newPage();

    if (template) {
      const pageContentGenerationTimeoutSeconds = +this.configService.get('PAGE_CONTENT_GENERATION_TIMEOUT_SECONDS') || 10;
      await page.setContent(template, { waitUntil: 'networkidle0', timeout: pageContentGenerationTimeoutSeconds * 1000 });
    }

    return page;
  }

  public async takePdfScreenshot(
    page: puppeteer.Page,
    template: string,
  ): Promise<string> {
    const logGroupName = 'takePdfScreenshot';

    console.info(`${logGroupName} started`);

    if (template) {
      const pageContentGenerationTimeoutSeconds = +this.configService.get('PAGE_CONTENT_GENERATION_TIMEOUT_SECONDS') || 10;
      await page.setContent(template, { waitUntil: 'networkidle0', timeout: pageContentGenerationTimeoutSeconds * 1000 });
    }

    const screenshotResult = await page.screenshot({
      encoding: 'base64',
      type: 'png',
    });

    return (screenshotResult) as string;
  }

  public async generatePreviews(
    patternData: PdfDataDto,
  ): Promise<PdfPreviewDto> {
    const logGroupName = 'generatePreviews';

    console.info(`${logGroupName} started`);

    const { isSimpleInstruction, isSecondaryColor, isImageInstruction } = handlebarsTemplates;
    const styles = await handlebarsStylesPartial(this.stylePath);
    const preparedPdfData = await this.preparePdfData(patternData);

    const basicPdfHtml = await compileTemplate(
      this.basicPreviewPath,
      preparedPdfData,
      {
        helpers: [isSimpleInstruction, isSecondaryColor, isImageInstruction],
        partials: [styles],
      },
    );

    const premiumPdfHtml = await compileTemplate(
      this.premiumPreviewPath,
      preparedPdfData,
      {
        partials: [styles],
      },
    );

    const page = await this.initializePage();
    const basicPreview = await this.takePdfScreenshot(page, basicPdfHtml);
    const premiumPreview = await this.takePdfScreenshot(page, premiumPdfHtml);

    await page.close();

    return {
      basicPreview,
      premiumPreview,
    };
  }

  public async generateBasicPDF(
    pdfData: BasicPdfDataDto,
  ): Promise<PdfPaymentResult> {
    const logGroupName = 'generateBasicPDF';

    console.info(`${logGroupName} started`);

    const { contactInfo, ...patternData } = pdfData;
    const { isSimpleInstruction, isSecondaryColor, isImageInstruction } = handlebarsTemplates;
    const styles = await handlebarsStylesPartial(this.stylePath);

    const preparedPdfData = await this.preparePdfData(patternData);

    const basicTemplate = await compileTemplate(
      this.basicTemplatePath,
      preparedPdfData,
      {
        helpers: [isSimpleInstruction, isSecondaryColor, isImageInstruction],
        partials: [styles],
      },
    );

    const footerTemplate = await compileTemplate(
      this.footerTemplatePath,
      preparedPdfData,
    );

    const pattern = await this.patternsService.createPattern({
      name: patternData.patternName,
      patternPieces: this.preparePatternPieces(patternData.patternPieces),
    });

    const fileName = `${pattern.name}-${pattern.id}-basic.pdf`;
    const page = await this.initializePage(basicTemplate);

    await page.emulateMediaType('print');
    const pdf = await page.pdf({
      format: 'a4',
      margin: {
        top: '36px',
        left: '36px',
        right: '36px',
        bottom: '100px',
      },
      displayHeaderFooter: true,
      headerTemplate: '<p></p>',
      footerTemplate,
      printBackground: true,
    });

    await page.close();

    const file = await this.filesService.createFile(fileName, pdf);

    await this.mailService.sendFreePattern(contactInfo, pattern, file);

    return {
      fileId: file.id,
      patternId: pattern.id,
    };
  }

  public async generatePremiumPDF(
    patternData: PremiumPdfDataDto,
  ): Promise<PdfPaymentResult> {
    const logGroupName = 'generateBasicPDF';

    console.info(`${logGroupName} started`);

    const { paymentPayload } = patternData;
    let paymentData = null;

    if (paymentPayload.coupon) {
      const couponOrCode = await this.paymentService.getCouponOrPromoCode(
        paymentPayload.coupon
      );

      await this.checkCouponOrCode(couponOrCode);
    } else {
      paymentData = await this.paymentService.createPaymentIntent(
        PAYMENT_AMOUNT,
        paymentPayload,
      );
    }

    const { isSimpleInstruction, isSecondaryColor, isImageInstruction } = handlebarsTemplates;
    const styles = await handlebarsStylesPartial(this.stylePath);
    const preparedPdfData = await this.preparePdfData(patternData);

    const premiumTemplate = await compileTemplate(
      this.premiumTemplatePath,
      preparedPdfData,
      {
        helpers: [isSimpleInstruction, isSecondaryColor, isImageInstruction],
        partials: [styles],
      },
    );

    const footerTemplate = await compileTemplate(
      this.footerTemplatePath,
      preparedPdfData,
    );

    const pattern = await this.patternsService.createPattern({
      name: patternData.patternName,
      patternPieces: this.preparePatternPieces(patternData.patternPieces),
    });

    const fileName = `${pattern.name}-${pattern.id}-premium.pdf`;
    const page = await this.initializePage(premiumTemplate);

    await page.emulateMediaType('print');
    await page.addStyleTag({ content: '.box-shadow-class {-webkit-print-color-adjust: exact; -webkit-filter: opacity(1);}' });
    const pdf = await page.pdf({
      format: 'a4',
      margin: {
        top: '36px',
        bottom: '110px',
      },
      displayHeaderFooter: true,
      headerTemplate: '<p></p>',
      footerTemplate,
      printBackground: true,
    });

    await page.close();

    const file = await this.filesService.createFile(fileName, pdf);

    const result: PdfPaymentResult = {
      fileId: file.id,
      patternId: pattern.id,
    };

    if (paymentData) {
      result.paymentId = paymentData.id;
      result.clientSecret = paymentData.client_secret;
    }

    return result;
  }

  public async sendPremiumPDF(data: SendPremiumPdfDto): Promise<void> {
    const { fileId, patternId, paymentId, paymentPayload, contactInfo } = data;
    const file = await this.filesService.getFile(fileId);
    const pattern = await this.patternsService.getPattern(patternId);
    const paymentIntent = await this.paymentService.retrievePaymentIntent(
      paymentId,
    );

    if (!paymentIntent.payment_method) {
      throw new BadRequestException('Payment does not exist!');
    }

    if (paymentIntent.status !== 'succeeded') {
      throw new BadRequestException('Premium PDF not paid yet!');
    }

    if (!file) {
      throw new BadRequestException('PDF file does not exist!');
    }

    if (!pattern) {
      throw new BadRequestException('Pattern does not exist!');
    }

    await this.mailService.sendPremiumPattern(
      contactInfo,
      pattern,
      file,
      paymentIntent,
      paymentPayload,
    );
  }

  public async sendCouponPDF(data: SendCouponPdfDto): Promise<void> {
    const { fileId, patternId, couponId, contactInfo } = data;
    const file = await this.filesService.getFile(fileId);
    const pattern = await this.patternsService.getPattern(patternId);

    const couponOrCode = await this.paymentService.getCouponOrPromoCode(
      couponId
    );

    await this.checkCouponOrCode(couponOrCode);

    if (!file) {
      throw new BadRequestException('PDF file does not exist!');
    }

    if (!pattern) {
      throw new BadRequestException('Pattern does not exist!');
    }

    await this.mailService.sendCouponPattern(
      contactInfo,
      pattern,
      file,
      couponId,
    );

    if (couponOrCode.type == 'promocode') {
      this.paymentService.setPromotionCodeInactive(couponOrCode.value.id);
    }
  }

  private async checkCouponOrCode(couponOrCode: GetCouponOrPromocodeResult): Promise<void> {
    let coupon = null;
    let promocode = null;

    if (couponOrCode.type === 'coupon') {
      coupon = couponOrCode.value;

      if (!coupon?.valid) {
        throw new BadRequestException(
          'That coupon code didn’t work or is expired.'
        );
      }
    }

    if (couponOrCode.type === 'promocode') {
      promocode = couponOrCode.value;

      if (!promocode.active) {
        throw new BadRequestException(
          'That promotion code didn’t work or is expired.'
        );
      }
    }

    if (!coupon && !promocode) {
      throw new BadRequestException('No such coupon or promotion code.');
    }
  }
}
