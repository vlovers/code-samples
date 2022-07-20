import React, { useCallback, useContext, useEffect, useMemo, useState, } from 'react';
import { Box, CircularProgress, Grid, Typography, useTheme, } from '@material-ui/core';
import { FormProvider, SubmitHandler, useForm } from 'react-hook-form';
import { observer } from 'mobx-react';
import _ from 'lodash';

import Modal from '../../Modal';
import Button from '../../UI/Button/Button';
import AssetInfoFormSection from './AssetInfoFormSection';
import ImagesFormSection from './AssetImagesFormSection';
import { IAssetForm, isFullPieceCategory, resolver, } from '../../../utils/validation/assetValidation';
import { assetFormStore, dashboardStore } from '../../../stores';
import { AssetCategoryEnum } from '../../../enums/asset-category.enum';
import { SelectItem } from '../AssetsTable/ColumnHeaderSelect';
import AssetInstructionsFormSection from './AssetInstructionsFormSection';
import { CreateAssetDto, UpdateAssetDto } from '../../../dto/asset.dto';
import { PieceTypeEnum } from '../../../enums/piece-type.enum';
import { SnackbarContext } from '../../SnackbarProvider/idnex';
import CenteredFlexbox from '../../UI/CenteredFlexbox';
import { ModalType } from '../../../utils/modalIcons';
import { ConfirmModalContext } from '../../ModalProviders/ConfirmModalProvider';
import { AssetStatusEnum } from "../../../enums/asset-status.enum";
import { AssetPremiumEnum } from "../../../enums/asset-premium.enum";

interface AssetFormModalProps {
  assetValues?: IAssetForm;
  isOpened: boolean;
  onCancel: () => void;
}

const AssetFormModal: React.FunctionComponent<AssetFormModalProps> = observer(
  ({ assetValues, isOpened, onCancel }) => {
    const [isLoading, setIsLoading] = useState(false);
    const { openSnackbar } = useContext(SnackbarContext);
    const { onModalOpen } = useContext(ConfirmModalContext);
    const theme = useTheme();

    const form = useForm<IAssetForm>({
      resolver,
      defaultValues: {
        ...assetValues,
        statusId: assetValues?.statusId || AssetStatusEnum.Draft,
        premium: assetValues?.premium || false,
      },
    });

    const { reset, register, unregister, handleSubmit } = form;

    const {
      filteredSubcategories,
      selectedCategoryId,
      selectedSubcategory,
      createSubcategory,
      deleteSubcategory,
      setSelectedCategory,
      setSelectedSubcategory,
    } = assetFormStore;

    const { createAsset, updateAsset, deleteAsset } = dashboardStore;

    const preparedStatuses = useMemo<SelectItem[]>(
      () => _.map(AssetStatusEnum, (id, name) => ({ id, name })),
      [],
    );

    const preparedPremium = useMemo<SelectItem[]>(
      () => _.map(AssetPremiumEnum, (id, name) => ({ id, name })),
      [],
    );

    const preparedCategories = useMemo<SelectItem[]>(
      () => _.map(AssetCategoryEnum, (id, name) => ({ id, name })),
      [],
    );

    const preparedSubcategories = useMemo<SelectItem[]>(
      () =>
        filteredSubcategories.map(
          ({ assets, ...item }): SelectItem => ({
            ...item,
            canDelete: _.isEmpty(assets),
          }),
        ),
      [filteredSubcategories],
    );

    const onAddSubcategory = useCallback(
      async (name: string) => {
        try {
          setIsLoading(true);
          await createSubcategory(name);
          openSnackbar({
            type: 'success',
            message: 'Subcategory created successfully!',
          });
        } catch (e) {
          openSnackbar({
            type: 'error',
            message: 'An error occurred while creating the subcategory!',
          });
        } finally {
          setIsLoading(false);
        }
      },
      [createSubcategory, openSnackbar],
    );

    const onDeleteSubcategory = useCallback(
      async (id: string) => {
        try {
          setIsLoading(true);
          await deleteSubcategory(id);
          openSnackbar({
            type: 'success',
            message: 'Subcategory deleted successfully!',
          });
        } catch (e) {
          openSnackbar({
            type: 'error',
            message: 'An error occurred while deleting a subcategory!',
          });
        } finally {
          setIsLoading(false);
        }
      },
      [deleteSubcategory, openSnackbar],
    );

    const selectCategory = useCallback(
      (category: AssetCategoryEnum | null) => {
        setSelectedCategory(category);

        if (isFullPieceCategory(category)) {
          unregister('leftPiece');
          unregister('rightPiece');
        } else {
          unregister('fullPiece');
          register('leftPiece');
          register('rightPiece');
        }
      },
      [register, unregister, setSelectedCategory],
    );

    const closeModal = useCallback(() => {
      setIsLoading(false);
      selectCategory(null);
      setSelectedSubcategory(null);
      reset({});
      onCancel();
    }, [onCancel, selectCategory, setSelectedSubcategory, reset]);

    const onSubmit = useCallback<SubmitHandler<IAssetForm>>(
      async (data) => {
        setIsLoading(true);

        const { fullPiece, leftPiece, rightPiece, ...otherData } = data;
        let pieces;

        if (isFullPieceCategory(otherData.categoryId)) {
          pieces = [
            {
              ...fullPiece,
              typeId: PieceTypeEnum.Center,
            },
          ];
        } else {
          pieces = [
            {
              ...leftPiece,
              typeId: PieceTypeEnum.Left,
            },
            {
              ...rightPiece,
              typeId: PieceTypeEnum.Right,
            },
          ];
        }

        const preparedAsset = {
          ...otherData,
          pieces,
        };
        const isCreating = _.isNil(assetValues);
        try {
          if (isCreating) {
            await createAsset(preparedAsset as CreateAssetDto);
          } else {
            await updateAsset(preparedAsset as UpdateAssetDto);
          }
          openSnackbar({
            type: 'success',
            message: `Asset has been successfully ${
              isCreating ? 'created' : 'updated'
            }!`,
          });
          closeModal();
        } catch (e) {
          openSnackbar({
            type: 'error',
            message: `An error occurred while ${
              isCreating ? 'creating' : 'updating'
            } an asset!`,
          });
        } finally {
          setIsLoading(false);
        }
      },
      [assetValues, createAsset, updateAsset, openSnackbar, closeModal],
    );

    useEffect(() => {
      if (assetValues && isOpened) {
        reset(assetValues);
        selectCategory(assetValues.categoryId);
        setSelectedSubcategory(assetValues.subcategoryId);
      }
    }, [reset, assetValues, isOpened, selectCategory, setSelectedSubcategory]);

    const onDeleteAsset = useCallback(async () => {
      if (assetValues?.id) {
        try {
          await deleteAsset(assetValues?.id);
          openSnackbar({
            type: 'success',
            message: 'Asset has been successfully deleted',
          });
        } catch (e) {
          openSnackbar({
            type: 'error',
            message: 'An error occurred while deleting the subcategory!',
          });
        }
      }
      closeModal();
    }, [assetValues, deleteAsset, openSnackbar, closeModal]);

    const onDeleteOrCancel = useCallback(() => {
      const isUpdating = !_.isNil(assetValues);
      onModalOpen({
        title: '',
        type: ModalType.WARN,
        text: `Are you sure you want to ${
          isUpdating ? 'delete the asset' : 'close the window'
        }?`,
        confirmText: 'Yes',
        cancelText: 'No',
        onConfirm: isUpdating ? onDeleteAsset : closeModal,
      });
    }, [assetValues, onModalOpen, onDeleteAsset, closeModal]);

    return (
      <Modal open={isOpened} onClose={closeModal}>
        <FormProvider {...form}>
          <form onSubmit={handleSubmit(onSubmit)}>
            <Box width={700} padding={2}>
              <Box height={64}>
                <Typography variant="h4">
                  <Box
                    component="span"
                    color={theme.palette.primary.main}
                    fontWeight={500}
                    marginRight={2.5}
                  >
                    {assetValues?.id ? 'ID' : 'New Piece'}
                  </Box>
                  {assetValues?.id && (
                    <Box component="span" fontWeight={500}>
                      {assetValues?.id}
                    </Box>
                  )}
                </Typography>
              </Box>
              <Grid container spacing={5}>
                <Grid item container spacing={3}>
                  <AssetInfoFormSection
                    premiums={preparedPremium}
                    statuses={preparedStatuses}
                    categories={preparedCategories}
                    subcategories={preparedSubcategories}
                    selectedCategoryId={selectedCategoryId}
                    selectedSubcategory={selectedSubcategory}
                    setSelectedCategory={selectCategory}
                    setSelectedSubcategory={setSelectedSubcategory}
                    onAddItem={onAddSubcategory}
                    onDeleteItem={onDeleteSubcategory}
                    isLoading={isLoading}
                  />
                </Grid>
                <Grid item container spacing={3}>
                  <ImagesFormSection selectedCategoryId={selectedCategoryId} isLoading={isLoading}/>
                </Grid>
                <Grid item container spacing={3} justifyContent="flex-end">
                  <AssetInstructionsFormSection isLoading={isLoading} />
                </Grid>
                <Grid item container spacing={3}>
                  <Grid item xs={6}>
                    <Box display="flex" justifyContent="flex-end">
                      <Button
                        width={200}
                        variant="contained"
                        color="secondary"
                        onClick={onDeleteOrCancel}
                      >
                        {assetValues ? 'Delete' : 'Cancel'}
                      </Button>
                    </Box>
                  </Grid>
                  <Grid item xs={6}>
                    <Box display="flex" justifyContent="flex-start">
                      <Button
                        width={200}
                        disabled={isLoading}
                        type="submit"
                        variant="contained"
                        color="primary"
                      >
                        {isLoading && (
                          <CenteredFlexbox marginRight={1}>
                            <CircularProgress size={20} />
                          </CenteredFlexbox>
                        )}
                        Save Changes
                      </Button>
                    </Box>
                  </Grid>
                </Grid>
              </Grid>
            </Box>
          </form>
        </FormProvider>
      </Modal>
    );
  },
);

export default AssetFormModal;
