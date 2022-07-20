import { action, computed, makeObservable, observable } from 'mobx';

import { AssetCategoryEnum } from '../enums/asset-category.enum';
import { SubcategoryDto } from '../dto/subcategory.dto';
import SubcategoriesService from '../data-services/SubcategoriesService';

export class AssetFormStore {
  @observable public selectedCategoryId: AssetCategoryEnum | null = null;
  @observable public selectedSubcategoryId: string | null = null;
  @observable public allSubcategories: SubcategoryDto[] = [];

  constructor(private readonly subcategoriesApi: SubcategoriesService) {
    makeObservable(this);
  }

  @computed public get selectedSubcategory(): SubcategoryDto | undefined {
    return this.allSubcategories?.find(
      ({ id }) => id === this.selectedSubcategoryId,
    );
  }

  @computed public get filteredSubcategories(): SubcategoryDto[] {
    return this.allSubcategories.filter(
      ({ categoryId }) => categoryId === this.selectedCategoryId,
    );
  }

  @action public setSelectedCategory = (
    category: AssetCategoryEnum | null,
  ): void => {
    this.selectedCategoryId = category;
  };

  @action public setSelectedSubcategory = (
    subcategory: string | null,
    callback?: (subcategory?: SubcategoryDto) => void,
  ): void => {
    this.selectedSubcategoryId = subcategory;
    callback?.(this.selectedSubcategory);
  };

  @action public loadSubcategories = async (): Promise<void> => {
    const { data } = await this.subcategoriesApi.getSubcategories();

    this.allSubcategories = data;
  };

  @action public createSubcategory = async (name: string): Promise<void> => {
    if (this.selectedCategoryId) {
      try {
        const { data } = await this.subcategoriesApi.createSubcategory({
          name,
          categoryId: this.selectedCategoryId,
        });

        if (data) {
          this.allSubcategories.push(data);
        }
      } catch (e) {
        console.error(e);
        throw e;
      }
    }
  };

  @action public deleteSubcategory = async (id: string): Promise<void> => {
    try {
      await this.subcategoriesApi.deleteSubcategory(id);

      this.allSubcategories = this.allSubcategories.filter(
        item => item.id !== id,
      );
    } catch (e) {
      console.error(e);
      throw e;
    }
  };
}
