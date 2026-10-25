import { IS_PRODUCTION_MODE } from './config';

export const DEFAULT_COVER_IMAGE = IS_PRODUCTION_MODE ? '' : '/static/images/zhiyin-forest-cabin.png';

export function getSafeCoverImage(value?: string) {
  return value?.trim() || DEFAULT_COVER_IMAGE;
}
