const normalizedId = (value) => String(value?._id || value || '');

const baseQuantity = (quantity, unit) => {
  const amount = Number(quantity);
  if (!Number.isFinite(amount) || amount < 0) return null;
  if (unit === 'kg') return { amount: amount * 1000, unit: 'g' };
  if (unit === 'l') return { amount: amount * 1000, unit: 'ml' };
  return { amount, unit };
};

const menuItems = (day) => {
  const meal = (value) => value?.items?.length ? value.items : value?.dishId ? [value] : [];
  const lunch = (list, legacy) => day.lunch?.[list]?.length ? day.lunch[list] : day.lunch?.[legacy]?.dishId ? [day.lunch[legacy]] : [];
  return [
    ...meal(day.breakfast), ...meal(day.morningSnack),
    ...lunch('mainDishes', 'mainDish'), ...lunch('stirFryDishes', 'stirFryDish'),
    ...lunch('soupDishes', 'soupDish'), ...lunch('desserts', 'dessert'),
    ...meal(day.afternoonSnack)
  ];
};

export const buildKitchenIngredientPlan = ({ classes = [], menus = [], dishes = [], inventory = [], date, dayOfWeek }) => {
  const menuByClass = new Map(menus.filter((menu) => menu.status === 'published').map((menu) => [normalizedId(menu.classroomId), menu]));
  const dishById = new Map(dishes.map((dish) => [normalizedId(dish._id), dish]));
  const required = new Map();
  const missingRecipes = new Set();
  const missingMenus = [];

  classes.forEach((classroom) => {
    if (!classroom.recommendedServings) return;
    const menu = menuByClass.get(normalizedId(classroom.classroomId));
    const day = menu?.days?.find((entry) => entry.dayOfWeek === dayOfWeek);
    if (!day) { missingMenus.push(classroom.className); return; }
    menuItems(day).forEach((item) => {
      const dish = dishById.get(normalizedId(item.dishId));
      const name = item.dishName || dish?.name || 'Món chưa xác định';
      if (!dish?.ingredients?.length) { missingRecipes.add(name); return; }
      dish.ingredients.forEach((ingredient) => {
        const ingredientId = normalizedId(ingredient.ingredientId);
        const converted = baseQuantity(ingredient.quantity, ingredient.unit);
        if (!ingredientId || !converted || converted.amount <= 0 || !converted.unit) {
          missingRecipes.add(`${name} — nguyên liệu chưa có mã/định lượng`);
          return;
        }
        const key = `${ingredientId}:${converted.unit}`;
        const current = required.get(key) || { ingredientId, ingredientName: ingredient.ingredientName || 'Nguyên liệu', unit: converted.unit, required: 0 };
        current.required += converted.amount * classroom.recommendedServings;
        required.set(key, current);
      });
    });
  });

  const available = new Map();
  const stockUnits = new Map();
  inventory.filter((lot) => Number(lot.quantity) > 0 && ['available', 'near_expiry'].includes(lot.status)
    && lot.expiryDate && new Date(lot.expiryDate).toISOString().slice(0, 10) >= date).forEach((lot) => {
    const ingredientId = normalizedId(lot.ingredientId);
    const converted = baseQuantity(lot.quantity, lot.unit);
    if (!ingredientId || !converted) return;
    const key = `${ingredientId}:${converted.unit}`;
    available.set(key, (available.get(key) || 0) + converted.amount);
    if (!stockUnits.has(ingredientId)) stockUnits.set(ingredientId, new Set());
    stockUnits.get(ingredientId).add(converted.unit);
  });

  return {
    rows: [...required.entries()].map(([key, item]) => ({
      ...item, available: available.get(key) || 0,
      shortage: Math.max(0, item.required - (available.get(key) || 0))
    })).sort((left, right) => left.ingredientName.localeCompare(right.ingredientName, 'vi')),
    missingRecipes: [...missingRecipes].sort((left, right) => left.localeCompare(right, 'vi')),
    missingMenus,
    incompatibleStockUnits: [...required.entries()].filter(([key, item]) =>
      !available.has(key) && stockUnits.has(item.ingredientId)
    ).map(([, item]) => `${item.ingredientName}: công thức ${item.unit}, kho ${[...stockUnits.get(item.ingredientId)].join('/')}`)
  };
};

export const displayIngredientQuantity = (amount, unit) => {
  if (unit === 'g' && amount >= 1000) return `${Number((amount / 1000).toFixed(3)).toLocaleString('vi-VN')} kg`;
  if (unit === 'ml' && amount >= 1000) return `${Number((amount / 1000).toFixed(3)).toLocaleString('vi-VN')} l`;
  return `${Number(amount.toFixed(3)).toLocaleString('vi-VN')} ${unit}`;
};
