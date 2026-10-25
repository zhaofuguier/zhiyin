export const UNIFIED_SCENE_ROUTE = '/pages/categories/index';

export function redirectLegacyStudentRoute(): void {
  uni.switchTab({ url: UNIFIED_SCENE_ROUTE });
}
