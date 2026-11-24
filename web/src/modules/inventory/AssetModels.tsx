// Asset models (E39): the list and one model's page (inventory/models.tsx holds the shared parts).
import { MODEL_KINDS, ModelDetail, ModelList } from './models';

export const AssetModelList = () => <ModelList kind={MODEL_KINDS.asset} />;
export const AssetModelDetail = () => <ModelDetail kind={MODEL_KINDS.asset} />;
