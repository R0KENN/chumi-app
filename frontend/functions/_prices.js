// Единый источник цен (в Telegram Stars, XTR).
// Импортируется и ботом (проверка суммы платежа), и API (создание инвойсов).
// ВАЖНО: меняй цену только здесь, чтобы проверка суммы не рассинхронизировалась.

export const SKIN_PRICES = {
  strawberry: 25,
  floral: 25,
  astronaut: 25,
};

export const PRODUCT_PRICES = {
  extra_slot: 33,
};

// Ожидаемая сумма платежа по «ключу продукта».
// skin / skin_gift стоят как соответствующий скин; productId — как товар.
// chargeKey: 'skin' | 'skin_gift' | productId, skinId нужен для скинов.
export function expectedAmount(chargeKey, skinId) {
  if (chargeKey === 'skin' || chargeKey === 'skin_gift') {
    return SKIN_PRICES[skinId];
  }
  return PRODUCT_PRICES[chargeKey];
}
