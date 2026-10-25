const THEME_KEY = 'zhiyinTheme';

export type AppTheme = 'light' | 'dark';

export function getTheme(): AppTheme {
  const value = uni.getStorageSync(THEME_KEY);
  if (value === '深色' || value === 'dark') return 'dark';
  return 'light';
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

export function applyTheme(theme = getTheme()) {
  const isDark = theme === 'dark';

  uni.setNavigationBarColor({
    frontColor: isDark ? '#ffffff' : '#000000',
    backgroundColor: isDark ? '#07111a' : '#f4f7f6'
  });

  uni.setTabBarStyle({
    color: isDark ? '#7f8d99' : '#8a97a4',
    selectedColor: isDark ? '#f2f7fb' : '#152331',
    backgroundColor: isDark ? '#07111a' : '#ffffff',
    borderStyle: isDark ? 'black' : 'white'
  });
}
