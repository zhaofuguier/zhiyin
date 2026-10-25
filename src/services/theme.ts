const THEME_KEY = 'zhiyinTheme';

export type AppTheme = 'light' | 'dark';

export function getTheme(): AppTheme {
  const value = uni.getStorageSync(THEME_KEY);
  if (value === '浅色' || value === 'light') return 'light';
  return 'dark';
}

export function getThemeLabel(theme = getTheme()) {
  return theme === 'dark' ? '深色' : '浅色';
}

export function setTheme(theme: AppTheme) {
  uni.setStorageSync(THEME_KEY, getThemeLabel(theme));
  applyTheme(theme);
}

export function toggleTheme() {
  const next = getTheme() === 'light' ? 'dark' : 'light';
  setTheme(next);
  return next;
}

export function applyTheme(_theme = getTheme()) {
  uni.setNavigationBarColor({
    frontColor: '#ffffff',
    backgroundColor: '#0b0f14'
  });

  uni.setTabBarStyle({
    color: '#9aa6b2',
    selectedColor: '#7ee7d6',
    backgroundColor: '#0b0f14',
    borderStyle: 'black'
  });
}
