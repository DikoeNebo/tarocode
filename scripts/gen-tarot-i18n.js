/**
 * One-shot generator for src/i18n/tarot/*.json — run once, then remove if desired.
 */
const fs = require("fs");
const path = require("path");

const CARD_IDS = [
  "fool", "magician", "high_priestess", "empress", "emperor", "hierophant",
  "lovers", "chariot", "strength", "hermit", "wheel_of_fortune", "justice",
  "hanged_man", "death", "temperance", "devil", "tower", "star", "moon", "sun",
  "judgement", "world",
  "wands_ace", "wands_02", "wands_03", "wands_04", "wands_05", "wands_06",
  "wands_07", "wands_08", "wands_09", "wands_10", "wands_page", "wands_knight",
  "wands_queen", "wands_king",
  "cups_ace", "cups_02", "cups_03", "cups_04", "cups_05", "cups_06", "cups_07",
  "cups_08", "cups_09", "cups_10", "cups_page", "cups_knight", "cups_queen",
  "cups_king",
  "swords_ace", "swords_02", "swords_03", "swords_04", "swords_05", "swords_06",
  "swords_07", "swords_08", "swords_09", "swords_10", "swords_page",
  "swords_knight", "swords_queen", "swords_king",
  "pentacles_ace", "pentacles_02", "pentacles_03", "pentacles_04", "pentacles_05",
  "pentacles_06", "pentacles_07", "pentacles_08", "pentacles_09", "pentacles_10",
  "pentacles_page", "pentacles_knight", "pentacles_queen", "pentacles_king",
];

const GROUP_KEYS = ["Major Arcana", "Wands", "Cups", "Swords", "Pentacles"];

const MAJOR = {
  en: [
    "The Fool", "The Magician", "The High Priestess", "The Empress", "The Emperor",
    "The Hierophant", "The Lovers", "The Chariot", "Strength", "The Hermit",
    "Wheel of Fortune", "Justice", "The Hanged Man", "Death", "Temperance",
    "The Devil", "The Tower", "The Star", "The Moon", "The Sun", "Judgement",
    "The World",
  ],
  ru: [
    "Дурак", "Маг", "Верховная Жрица", "Императрица", "Император", "Иерофант",
    "Влюблённые", "Колесница", "Сила", "Отшельник", "Колесо Фортуны",
    "Справедливость", "Повешенный", "Смерть", "Умеренность", "Дьявол", "Башня",
    "Звезда", "Луна", "Солнце", "Суд", "Мир",
  ],
  uk: [
    "Блазень", "Маг", "Верховна Жриця", "Імператриця", "Імператор", "Ієрофант",
    "Закохані", "Колісниця", "Сила", "Пустельник", "Колесо Фортуни",
    "Справедливість", "Повішений", "Смерть", "Помірність", "Диявол", "Вежа",
    "Зірка", "Місяць", "Сонце", "Суд", "Світ",
  ],
  de: [
    "Der Narr", "Der Magier", "Die Hohepriesterin", "Die Kaiserin", "Der Kaiser",
    "Der Hierophant", "Die Liebenden", "Der Wagen", "Die Kraft", "Der Eremit",
    "Rad des Schicksals", "Die Gerechtigkeit", "Der Gehängte", "Der Tod",
    "Die Mäßigkeit", "Der Teufel", "Der Turm", "Der Stern", "Der Mond",
    "Die Sonne", "Das Gericht", "Die Welt",
  ],
  es: [
    "El Loco", "El Mago", "La Sacerdotisa", "La Emperatriz", "El Emperador",
    "El Hierofante", "Los Enamorados", "El Carro", "La Fuerza", "El Ermitaño",
    "La Rueda de la Fortuna", "La Justicia", "El Colgado", "La Muerte",
    "La Templanza", "El Diablo", "La Torre", "La Estrella", "La Luna",
    "El Sol", "El Juicio", "El Mundo",
  ],
  fr: [
    "Le Mat", "Le Bateleur", "La Papesse", "L'Impératrice", "L'Empereur",
    "Le Pape", "Les Amoureux", "Le Chariot", "La Force", "L'Ermite",
    "La Roue de Fortune", "La Justice", "Le Pendu", "La Mort", "Tempérance",
    "Le Diable", "La Maison Dieu", "L'Étoile", "La Lune", "Le Soleil",
    "Le Jugement", "Le Monde",
  ],
  "pt-BR": [
    "O Louco", "O Mago", "A Sacerdotisa", "A Imperatriz", "O Imperador",
    "O Hierofante", "Os Enamorados", "O Carro", "A Força", "O Eremita",
    "A Roda da Fortuna", "A Justiça", "O Enforcado", "A Morte", "A Temperança",
    "O Diabo", "A Torre", "A Estrela", "A Lua", "O Sol", "O Julgamento",
    "O Mundo",
  ],
  "zh-CN": [
    "愚者", "魔术师", "女祭司", "皇后", "皇帝", "教皇", "恋人", "战车", "力量",
    "隐士", "命运之轮", "正义", "倒吊人", "死神", "节制", "恶魔", "塔", "星星",
    "月亮", "太阳", "审判", "世界",
  ],
  ja: [
    "愚者", "魔術師", "女教皇", "女帝", "皇帝", "教皇", "恋人", "戦車", "力",
    "隠者", "運命の輪", "正義", "吊るされた男", "死神", "節制", "悪魔", "塔",
    "星", "月", "太陽", "審判", "世界",
  ],
  pl: [
    "Głupiec", "Mag", "Kapłanka", "Cesarzowa", "Cesarz", "Hierofant",
    "Kochankowie", "Rydwan", "Siła", "Pustelnik", "Koło Fortuny", "Sprawiedliwość",
    "Wisielec", "Śmierć", "Umiarkowanie", "Diabeł", "Wieża", "Gwiazda", "Księżyc",
    "Słońce", "Sąd", "Świat",
  ],
};

const GROUPS = {
  en: {
    "Major Arcana": "Major Arcana",
    Wands: "Wands",
    Cups: "Cups",
    Swords: "Swords",
    Pentacles: "Pentacles",
  },
  ru: {
    "Major Arcana": "Старшие Арканы",
    Wands: "Жезлы",
    Cups: "Кубки",
    Swords: "Мечи",
    Pentacles: "Пентакли",
  },
  uk: {
    "Major Arcana": "Старші Аркани",
    Wands: "Жезли",
    Cups: "Кубки",
    Swords: "Мечі",
    Pentacles: "Пентаклі",
  },
  de: {
    "Major Arcana": "Große Arkana",
    Wands: "Stäbe",
    Cups: "Kelche",
    Swords: "Schwerter",
    Pentacles: "Münzen",
  },
  es: {
    "Major Arcana": "Arcanos Mayores",
    Wands: "Bastos",
    Cups: "Copas",
    Swords: "Espadas",
    Pentacles: "Oros",
  },
  fr: {
    "Major Arcana": "Arcanes Majeurs",
    Wands: "Bâtons",
    Cups: "Coupes",
    Swords: "Épées",
    Pentacles: "Deniers",
  },
  "pt-BR": {
    "Major Arcana": "Arcanos Maiores",
    Wands: "Paus",
    Cups: "Copas",
    Swords: "Espadas",
    Pentacles: "Ouros",
  },
  "zh-CN": {
    "Major Arcana": "大阿尔卡纳",
    Wands: "权杖",
    Cups: "圣杯",
    Swords: "宝剑",
    Pentacles: "星币",
  },
  ja: {
    "Major Arcana": "大アルカナ",
    Wands: "ワンド",
    Cups: "カップ",
    Swords: "ソード",
    Pentacles: "ペンタクル",
  },
  pl: {
    "Major Arcana": "Wielkie Arkana",
    Wands: "Buławy",
    Cups: "Kielichy",
    Swords: "Miecze",
    Pentacles: "Pentakle",
  },
};

const RANKS = {
  en: {
    ace: "Ace",
    "02": "Two",
    "03": "Three",
    "04": "Four",
    "05": "Five",
    "06": "Six",
    "07": "Seven",
    "08": "Eight",
    "09": "Nine",
    10: "Ten",
    page: "Page",
    knight: "Knight",
    queen: "Queen",
    king: "King",
  },
  ru: {
    ace: "Туз",
    "02": "Двойка",
    "03": "Тройка",
    "04": "Четвёрка",
    "05": "Пятёрка",
    "06": "Шестёрка",
    "07": "Семёрка",
    "08": "Восьмёрка",
    "09": "Девятка",
    10: "Десятка",
    page: "Паж",
    knight: "Рыцарь",
    queen: "Королева",
    king: "Король",
  },
  uk: {
    ace: "Туз",
    "02": "Двійка",
    "03": "Трійка",
    "04": "Четвірка",
    "05": "П'ятірка",
    "06": "Шістка",
    "07": "Сімка",
    "08": "Восьмерка",
    "09": "Дев'ятка",
    10: "Десятка",
    page: "Паж",
    knight: "Лицар",
    queen: "Королева",
    king: "Король",
  },
  de: {
    ace: "Ass",
    "02": "Zwei",
    "03": "Drei",
    "04": "Vier",
    "05": "Fünf",
    "06": "Sechs",
    "07": "Sieben",
    "08": "Acht",
    "09": "Neun",
    10: "Zehn",
    page: "Page",
    knight: "Ritter",
    queen: "Königin",
    king: "König",
  },
  es: {
    ace: "As",
    "02": "Dos",
    "03": "Tres",
    "04": "Cuatro",
    "05": "Cinco",
    "06": "Seis",
    "07": "Siete",
    "08": "Ocho",
    "09": "Nueve",
    10: "Diez",
    page: "Sota",
    knight: "Caballero",
    queen: "Reina",
    king: "Rey",
  },
  fr: {
    ace: "As",
    "02": "Deux",
    "03": "Trois",
    "04": "Quatre",
    "05": "Cinq",
    "06": "Six",
    "07": "Sept",
    "08": "Huit",
    "09": "Neuf",
    10: "Dix",
    page: "Valet",
    knight: "Cavalier",
    queen: "Reine",
    king: "Roi",
  },
  "pt-BR": {
    ace: "Ás",
    "02": "Dois",
    "03": "Três",
    "04": "Quatro",
    "05": "Cinco",
    "06": "Seis",
    "07": "Sete",
    "08": "Oito",
    "09": "Nove",
    10: "Dez",
    page: "Pajem",
    knight: "Cavaleiro",
    queen: "Rainha",
    king: "Rei",
  },
  "zh-CN": {
    ace: "王牌",
    "02": "二",
    "03": "三",
    "04": "四",
    "05": "五",
    "06": "六",
    "07": "七",
    "08": "八",
    "09": "九",
    10: "十",
    page: "侍从",
    knight: "骑士",
    queen: "王后",
    king: "国王",
  },
  ja: {
    ace: "エース",
    "02": "2",
    "03": "3",
    "04": "4",
    "05": "5",
    "06": "6",
    "07": "7",
    "08": "8",
    "09": "9",
    10: "10",
    page: "ペイジ",
    knight: "ナイト",
    queen: "クイーン",
    king: "キング",
  },
  pl: {
    ace: "As",
    "02": "Dwójka",
    "03": "Trójka",
    "04": "Czwórka",
    "05": "Piątka",
    "06": "Szóstka",
    "07": "Siódemka",
    "08": "Ósemka",
    "09": "Dziewiątka",
    10: "Dziesiątka",
    page: "Paź",
    knight: "Rycerz",
    queen: "Królowa",
    king: "Król",
  },
};

const SUIT_GENITIVE = {
  ru: { wands: "Жезлов", cups: "Кубков", swords: "Мечей", pentacles: "Пентаклей" },
  uk: { wands: "Жезлів", cups: "Кубків", swords: "Мечів", pentacles: "Пентаклів" },
};

function minorName(locale, suitKey, rankKey) {
  const suit = GROUPS[locale][suitKey];
  const rank = RANKS[locale][rankKey];

  if (locale === "en") {
    if (rankKey === "ace") return `Ace of ${suit}`;
    if (["page", "knight", "queen", "king"].includes(rankKey)) {
      return `${rank} of ${suit}`;
    }
    return `${rank} of ${suit}`;
  }

  if (locale === "ru" || locale === "uk") {
    const gen = SUIT_GENITIVE[locale][suitKey.toLowerCase()];
    if (rankKey === "ace") return `${rank} ${gen}`;
    if (["page", "knight", "queen", "king"].includes(rankKey)) {
      return `${rank} ${gen}`;
    }
    return `${rank} ${gen}`;
  }

  if (locale === "de") {
    if (rankKey === "ace") return `${rank} der ${suit}`;
    if (["page", "knight", "queen", "king"].includes(rankKey)) {
      return `${rank} der ${suit}`;
    }
    return `${rank} der ${suit}`;
  }

  if (locale === "es" || locale === "pt-BR") {
    if (rankKey === "ace") return `${rank} de ${suit}`;
    if (["page", "knight", "queen", "king"].includes(rankKey)) {
      return `${rank} de ${suit}`;
    }
    return `${rank} de ${suit}`;
  }

  if (locale === "fr") {
    const suitFr = suitKey === "Cups" ? "Coupe" : suit;
    if (rankKey === "ace") return `${rank} de ${suitFr}`;
    if (["page", "knight", "queen", "king"].includes(rankKey)) {
      return `${rank} de ${suitFr}`;
    }
    return `${rank} de ${suitFr}`;
  }

  if (locale === "zh-CN") {
    if (rankKey === "ace") return `${suit}${rank}`;
    if (["page", "knight", "queen", "king"].includes(rankKey)) {
      return `${suit}之${rank}`;
    }
    return `${suit}${rank}`;
  }

  if (locale === "ja") {
    if (rankKey === "ace") return `${suit}の${rank}`;
    if (["page", "knight", "queen", "king"].includes(rankKey)) {
      return `${suit}の${rank}`;
    }
    return `${suit}の${rank}`;
  }

  if (locale === "pl") {
    if (rankKey === "ace") return `${rank} ${suit}`;
    if (["page", "knight", "queen", "king"].includes(rankKey)) {
      return `${rank} ${suit}`;
    }
    return `${rank} ${suit}`;
  }

  return `${rank} ${suit}`;
}

function buildLocale(locale) {
  const cards = {};
  const majorIds = CARD_IDS.slice(0, 22);
  majorIds.forEach((id, i) => {
    cards[id] = MAJOR[locale][i];
  });

  const suits = [
    { prefix: "wands", group: "Wands" },
    { prefix: "cups", group: "Cups" },
    { prefix: "swords", group: "Swords" },
    { prefix: "pentacles", group: "Pentacles" },
  ];
  const ranks = [
    "ace", "02", "03", "04", "05", "06", "07", "08", "09", "10",
    "page", "knight", "queen", "king",
  ];

  for (const { prefix, group } of suits) {
    for (const rank of ranks) {
      const id = `${prefix}_${rank}`;
      cards[id] = minorName(locale, group, rank);
    }
  }

  return { groups: GROUPS[locale], cards };
}

const outDir = path.join(__dirname, "..", "src", "i18n", "tarot");
const locales = ["en", "ru", "uk", "de", "es", "fr", "pt-BR", "zh-CN", "ja", "pl"];

for (const locale of locales) {
  const data = buildLocale(locale);
  const cardCount = Object.keys(data.cards).length;
  const groupCount = Object.keys(data.groups).length;
  if (cardCount !== 78) throw new Error(`${locale}: expected 78 cards, got ${cardCount}`);
  if (groupCount !== 5) throw new Error(`${locale}: expected 5 groups, got ${groupCount}`);
  for (const id of CARD_IDS) {
    if (!data.cards[id]) throw new Error(`${locale}: missing card id ${id}`);
  }
  fs.writeFileSync(
    path.join(outDir, `${locale}.json`),
    `${JSON.stringify(data, null, 2)}\n`,
    "utf8"
  );
  console.log(`${locale}.json — groups: ${groupCount}, cards: ${cardCount}`);
}
