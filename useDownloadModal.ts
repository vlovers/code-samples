import { useCallback, useContext } from 'react';
import { SubmitHandler } from 'react-hook-form';
import { StripeCardNumberElement } from '@stripe/stripe-js';
import _ from 'lodash';

import { validatePattern } from '../validatePattern';
import { SnackbarContext } from '../../components/SnackbarProvider/idnex';
import { DownloadModalContext } from '../../components/ModalProviders/DownloadModalProvider';
import { patternStore } from '../../stores';
import { PieceDto } from '../../dto/piece.dto';
import {
  AssetPdfDataDto,
  PiecePdfDataDto,
} from '../../dto/pattern-pdf-data.dto';
import { IContactInfoForm } from '../validation/contactInfoValidation';
import { pdfApi } from '../../data-services';
import useConfirmModal from './useConfirmModal';
import useHelpModal from './useHelpModal';
import {
  EMAIL_NOT_RECEIVED_SUPPORT_URL,
  PAYMENT_AMOUNT,
} from '../../constants';
import {
  QuestionsForDownLoadError,
  QuestionsForFailedPayment,
} from '../../constants/helpQuestions';
import { IPaymentForm } from '../validation/paymentFormValidation';
import { stripePromise } from '../stripe';
import { ICouponForm } from '../validation/couponFormValidation';
import { DownloadModalTabsEnum } from '../../enums/download-modal-tabs.enum';
import { GAEventNames } from '../../enums/ga-event-names.enum';
import useGAEventsHelper from './useGAEventsHelper';
import { PickerColors } from '../../enums/colors';
import { calculatePatternSize } from '../calculatePatternSize';
import useSendinblueEvents from './useSendinblueEvents';
import { splitColorName } from '../splitColorName';

interface DownloadModalResult {
  handleBasicFormSubmit: SubmitHandler<IContactInfoForm>;
  handleCouponFormSubmit: SubmitHandler<ICouponForm>;
  handleCouponContactFormSubmit: SubmitHandler<IContactInfoForm>;
  handlePremiumFormSubmit(
    data: IPaymentForm,
    cardNumber: StripeCardNumberElement,
  ): void;
  openDownloadModal(): void;
  generatePdfPreviews(): void;
}

const useDownloadModal = (): DownloadModalResult => {
  const { openModal, modalParams, setModalParams, cancelModal }
    = useContext(DownloadModalContext);
  const { openHelpModal } = useHelpModal();
  const { openSnackbar } = useContext(SnackbarContext);
  const { openCheckEmailModal, openErrorModal } = useConfirmModal();
  const { patternName, patternPieces, patternAssets } = patternStore;
  const { gaEvent, purchaseEvent } = useGAEventsHelper();
  const { sibFreePatternEvent, sibPremiumPatternEvent } = useSendinblueEvents();

  const preparePatternPieces = useCallback(
    () =>
      _.map(patternPieces, ({ piece, ...other }): PiecePdfDataDto => {
        const preparedPiece = _.omit(other, [
          'pattern',
          'createdAt',
          'updatedAt',
        ]);
        const patternPiecesSize = calculatePatternSize(patternPieces);
        preparedPiece.positionX = Math.round(preparedPiece.positionX - patternPiecesSize.minPosX);
        preparedPiece.positionY = Math.round(preparedPiece.positionY - patternPiecesSize.minPosY);

        const primaryColorName = _.findKey(
          PickerColors,
          value => value.toLowerCase() === other.primaryColor?.toLowerCase(),
        ) ?? 'White';
        const secondaryColorName = _.findKey(
          PickerColors,
          value =>
            value.toLowerCase() === other.secondaryColor?.toLowerCase(),
        );

        return {
          ...preparedPiece,
          piece,
          rotateDeg: preparedPiece.rotateDeg ?? 0,
          primaryColorName: splitColorName(primaryColorName),
          secondaryColorName: splitColorName(secondaryColorName),
          categoryId: piece.asset.categoryId,
          zIndex: piece.asset.category?.zIndex,
          height: piece.asset.height,
        };
      }),
    [patternPieces],
  );

  const preparePatternAssets = useCallback(
    (patternPieces?: PiecePdfDataDto[]) =>
      _.map(patternAssets, (asset): AssetPdfDataDto => {
        const values = _.pick(asset, [
          'id',
          'name',
          'height',
          'instructions',
          'pieces',
        ]);

        if (patternPieces) {
          values.pieces = _.reduce(
            patternPieces,
            (acc, { piece }) => {
              if (piece.assetId === asset.id) {
                return [...acc, piece];
              }

              return acc;
            },
            [] as PieceDto[],
          );
        }

        return {
          ...values,
          instructions: _.orderBy(values.instructions, ['createdAt'], ['asc']),
        };
      }),
    [patternAssets],
  );

  const generatePdfPreviews = useCallback(async () => {
    const patternPieces = preparePatternPieces();
    const patternAssets = preparePatternAssets();
    const patternPiecesSize = calculatePatternSize(patternPieces);

    const { data } = await pdfApi.generatePdfPreviews({
      patternName,
      patternPieces,
      patternAssets,
      patternPiecesSize,
    });

    setModalParams({
      pdfPreviews: data,
    });
  }, [patternName, preparePatternPieces, preparePatternAssets, setModalParams]);

  const handleBasicFormSubmit = useCallback<SubmitHandler<IContactInfoForm>>(
    async (data) => {
      try {
        setModalParams({ isLoading: true });
        gaEvent(GAEventNames.AddShippingInfo, {
          pattern: 'free',
        });
        const patternAssets = preparePatternAssets();
        const patternPieces = preparePatternPieces();

        await pdfApi.generateBasicPdf({
          patternName,
          patternAssets,
          patternPieces,
          contactInfo: data,
        });

        openCheckEmailModal({
          text: `Your free PDF was sent to ${data.email}`,
          helpTextUrl: EMAIL_NOT_RECEIVED_SUPPORT_URL,
        });
        purchaseEvent('free');
        sibFreePatternEvent(data);
        cancelModal();
      } catch (e) {
        openErrorModal({
          title: 'There Was a Problem',
          text: 'Go back and try downloading your pattern again.',
          onHelpClick: openHelpModal(
            'Help topic title',
            QuestionsForDownLoadError,
            'download_error',
          ),
        });
        console.error(e);
      } finally {
        setModalParams({ isLoading: false });
      }
    },
    [
      gaEvent,
      purchaseEvent,
      sibFreePatternEvent,
      patternName,
      setModalParams,
      cancelModal,
      openCheckEmailModal,
      openErrorModal,
      preparePatternAssets,
      preparePatternPieces,
      openHelpModal,
    ],
  );

  const handlePremiumFormSubmit = useCallback(
    async (
      paymentFormData: IPaymentForm,
      cardNumber: StripeCardNumberElement,
    ) => {
      try {
        setModalParams({ isLoading: true });
        const patternPieces = preparePatternPieces();
        const patternAssets = preparePatternAssets(patternPieces);
        const patternPiecesSize = calculatePatternSize(patternPieces);
        const stripe = await stripePromise;
        const { contactInfo } = modalParams;

        const paymentPayload = {
          firstName: paymentFormData.firstName,
          lastName: paymentFormData.lastName,
          zipCode: paymentFormData.zipCode,
        };

        const { data } = await pdfApi.generatePremiumPdf({
          patternName,
          patternPieces,
          patternAssets,
          paymentPayload,
          patternPiecesSize,
        });

        if (stripe && contactInfo && data.clientSecret && data.paymentId) {
          const response = await stripe.confirmCardPayment(data.clientSecret, {
            payment_method: {
              card: cardNumber,
              billing_details: {
                name: `${paymentFormData.firstName} ${paymentFormData.lastName}`,
                address: {
                  postal_code: paymentFormData.zipCode,
                },
              },
            },
          });

          if (!response.error) {
            try {
              await pdfApi.sendPremiumPdf({
                patternId: data.patternId,
                fileId: data.fileId,
                paymentId: data.paymentId,
                paymentPayload,
                contactInfo,
              });
            } catch (e) {
              console.error(e);
              openErrorModal({
                title: 'There Was a Problem',
                text: 'Go back and try downloading your pattern again.',
                onHelpClick: openHelpModal(
                  'Help topic title',
                  QuestionsForDownLoadError,
                  'download_error',
                ),
              });

              return;
            }

            openCheckEmailModal({
              text: `Your premium PDF was sent to ${contactInfo?.email}`,
              helpTextUrl: EMAIL_NOT_RECEIVED_SUPPORT_URL,
            });
            purchaseEvent('premium', PAYMENT_AMOUNT);
            sibPremiumPatternEvent(contactInfo);
            cancelModal();
          } else {
            throw new Error('Payment fail');
          }
        } else {
          throw new Error('Payment fail');
        }
      } catch (e) {
        console.error(e);
        openErrorModal({
          title: 'Sorry! Your Payment Failed',
          text: 'There was a problem with your payment.',
          onHelpClick: openHelpModal(
            'Help topic title',
            QuestionsForFailedPayment,
            'payment_failed',
          ),
        });
      } finally {
        setModalParams({ isLoading: false });
      }
    },
    [
      purchaseEvent,
      sibPremiumPatternEvent,
      cancelModal,
      modalParams,
      patternName,
      preparePatternPieces,
      preparePatternAssets,
      openHelpModal,
      setModalParams,
      openErrorModal,
      openCheckEmailModal,
    ],
  );

  const handleCouponFormSubmit = useCallback<SubmitHandler<ICouponForm>>(
    async ({ coupon }) => {
      if (!coupon || modalParams.isLoading) {
        return;
      }
      setModalParams({ isLoading: true });
      try {
        const { data } = await pdfApi.getCoupon(coupon);

        setModalParams({
          activeTab: DownloadModalTabsEnum.CouponContactFormTab,
          isLoading: false,
          couponState: {
            discount: data?.percentOff,
            error: false,
            couponId: data.id,
          },
        });
      } catch (e) {
        setModalParams({
          isLoading: false,
          couponState: {
            discount: 0,
            error: true,
          },
        });
      }
    },
    [modalParams, setModalParams],
  );

  const handleCouponContactFormSubmit = useCallback<
    SubmitHandler<IContactInfoForm>
  >(
    async (formData) => {
      try {
        setModalParams({ isLoading: true });
        gaEvent(GAEventNames.AddShippingInfo, {
          pattern: 'coupon',
        });
        const patternPieces = preparePatternPieces();
        const patternAssets = preparePatternAssets(patternPieces);
        const patternPiecesSize = calculatePatternSize(patternPieces);
        const { couponState } = modalParams;

        if (couponState.couponId) {
          const { data } = await pdfApi.generatePremiumPdf({
            patternName,
            patternPieces,
            patternAssets,
            paymentPayload: {
              coupon: couponState.couponId,
            },
            patternPiecesSize,
          });

          await pdfApi.sendCouponPdf({
            patternId: data.patternId,
            fileId: data.fileId,
            couponId: couponState.couponId,
            contactInfo: formData,
          });
        } else {
          openErrorModal({
            title: 'There Was a Problem',
            text: 'Go back and try downloading your pattern again.',
            onHelpClick: openHelpModal(
              'Help topic title',
              QuestionsForDownLoadError,
              'download_error',
            ),
          });
        }

        openCheckEmailModal({
          text: `Your premium PDF was sent to ${formData?.email}`,
          helpTextUrl: EMAIL_NOT_RECEIVED_SUPPORT_URL,
        });
        purchaseEvent('coupon');
        sibPremiumPatternEvent(formData);
        cancelModal();
      } catch (e) {
        console.error(e);
        openErrorModal({
          title: 'There Was a Problem',
          text: 'Go back and try downloading your pattern again.',
          onHelpClick: openHelpModal(
            'Help topic title',
            QuestionsForDownLoadError,
            'download_error',
          ),
        });
      } finally {
        setModalParams({
          isLoading: false,
        });
      }
    },
    [
      gaEvent,
      modalParams,
      patternName,
      setModalParams,
      cancelModal,
      openHelpModal,
      preparePatternAssets,
      preparePatternPieces,
      openCheckEmailModal,
      sibPremiumPatternEvent,
      purchaseEvent,
      openErrorModal,
    ],
  );

  const openDownloadModal = useCallback(() => {
    try {
      gaEvent(GAEventNames.ClickDownload);
      validatePattern({ name: patternName, patternPieces });
      openModal();
    } catch (e: any) {
      openSnackbar({
        type: 'error',
        message: e.message,
      });
    }
  }, [gaEvent, patternName, patternPieces, openModal, openSnackbar]);

  return {
    openDownloadModal,
    generatePdfPreviews,
    handleBasicFormSubmit,
    handleCouponFormSubmit,
    handlePremiumFormSubmit,
    handleCouponContactFormSubmit,
  };
};

export default useDownloadModal;
