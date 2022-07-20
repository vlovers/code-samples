import { action, computed, makeObservable, observable, runInAction } from 'mobx';
import _ from 'lodash';

import { AssetDto } from '../dto/asset.dto';
import AssetsService from '../data-services/AssetsService';
import { SubcategoryDto } from '../dto/subcategory.dto';
import { AssetCategoryEnum } from '../enums/asset-category.enum';
import { PieceDto } from '../dto/piece.dto';

export class AssetsLibraryStore {
  @observable public isLoading = false;
  @observable public isSvgLoading = false;
  @observable public assets: AssetDto[] = [];
  @observable public searchText = '';
  @observable public selectedSubcategoryId: string | null = null;
  @observable public selectedCategoryId: AssetCategoryEnum =
    AssetCategoryEnum.Head;

  constructor(private readonly assetsApi: AssetsService) {
    makeObservable(this);
  }

  @computed public get filteredAssets(): AssetDto[] | undefined {
    let filtered: AssetDto[];

    if (!_.isEmpty(this.searchText)) {
      filtered = this.assets.filter(
        asset => asset.name.toLowerCase().includes(this.searchText.toLowerCase()),
      );
    } else {
      filtered = this.assets.filter(
        asset => asset.categoryId === this.selectedCategoryId,
      );
    }

    if (this.selectedSubcategoryId) {
      filtered = filtered.filter(
        asset => this.selectedSubcategoryId === asset.subcategoryId,
      );
    }

    return filtered;
  }

  @computed public get filteredAssetsIds(): string[] | undefined {
    return this.filteredAssets?.map(x => x.id);
  }

  @computed public get subcategories(): SubcategoryDto[] {
    const isSearch = !_.isEmpty(this.searchText);
    let chain = _.chain(this.assets);

    if (isSearch) {
      chain = chain.filter(
        asset => asset.name.toLowerCase().includes(this.searchText.toLowerCase()),
      );
    } else {
      chain = chain.filter({ categoryId: this.selectedCategoryId });
    }

    return chain
      .reduce(
        (acc, { subcategory }) => (subcategory ? [...acc, subcategory] : acc),
        [] as SubcategoryDto[],
      )
      .uniqBy('id')
      .value();
  }

  @action public setLoading = (value: boolean): void => {
    this.isLoading = value;
  };

  @action public setSvgLoading = (value: boolean): void => {
    this.isSvgLoading = value;
  };

  @action public getAssetsList = async (): Promise<void> => {
    try {
      this.setLoading(true);
      this.setSvgLoading(true);
      const { data } = await this.assetsApi.getAssets(undefined, false);
      runInAction(() => {
        this.assets = data;
      });
    } catch (e) {
      console.error(e);
    } finally {
      this.setLoading(false);
      this.setSvgLoading(false);
    }
  };

  @action public loadPiecesForAssets = async (ids: string[]): Promise<void> => {
    try {
      this.setLoading(true);

      await Promise.all(ids.map(this.loadPiecesForAsset));
    } catch (e) {
      console.error(e);
    } finally {
      this.setLoading(false);
    }
  };

  @action public loadPiecesForAsset = async (id: string): Promise<void> => {
    const asset = this.assets.find(asset => asset.id === id);

    if (!asset || asset?.pieces?.length) {
      return;
    }

    const { data: pieces } = await this.assetsApi.getAssetPieces(id);
    this.setAssetPieces(asset, pieces);
  };

  @action public selectCategory = (categoryId: AssetCategoryEnum): void => {
    this.selectedCategoryId = categoryId;
  };

  @action public setSearchText = (text: string): void => {
    this.searchText = text;
  };

  @action public selectSubcategory = (subcategoryId: string | null): void => {
    this.selectedSubcategoryId
      = this.selectedSubcategoryId !== subcategoryId ? subcategoryId : null;
  };

  @action private setAssetPieces = (asset: AssetDto, pieces: PieceDto[]): AssetDto => {
    asset.pieces = pieces;

    return asset;
  };
}
