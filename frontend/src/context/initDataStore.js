let _initData = '';

export function getInitData() {
  if (_initData) {
    return _initData;
  }

  if (
    typeof window !== 'undefined' &&
    typeof window.Telegram?.WebApp?.initData ===
      'string'
  ) {
    return (
      window.Telegram.WebApp.initData ||
      ''
    );
  }

  return '';
}

export function setInitDataGlobal(value) {
  _initData =
    typeof value === 'string'
      ? value
      : '';
}
