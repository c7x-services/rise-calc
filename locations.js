/** Location access info for Bomj map. */

export const LOCATIONS = [
  {
    id: "bomj-city",
    name: "Бомж-Сити",
    aliases: ["бомж-сити", "бомж сити", "средневековый район"],
    rebirth: 0,
    fare: 0,
    note: "Стартовая локация. Киберпанк −815 127 −847 · Средневековье −830 127 −895",
  },
  {
    id: "farm",
    name: "Загородная ферма",
    aliases: ["ферма", "загородная ферма"],
    rebirth: 0,
    fare: 30,
    note: "Проезд 30 руб.",
  },
  {
    id: "forest",
    name: "Лес",
    aliases: ["лес"],
    rebirth: 1,
    fare: 500,
    note: "Нужно R1+, проезд 500 руб.",
  },
  {
    id: "port",
    name: "Порт",
    aliases: ["порт"],
    rebirth: 0,
    fare: 1000,
    note: "Проезд 1K руб.",
  },
  {
    id: "cyprus",
    name: "Кипр",
    aliases: ["кипр"],
    rebirth: 3,
    fare: 100_000,
    note: "R3+, проезд 100K. Только через Порт (−570 91 −1318)",
  },
  {
    id: "igora",
    name: "Игора",
    aliases: ["игора"],
    rebirth: 5,
    fare: 500_000,
    note: "Горнолыжный курорт. R5+, проезд 500K",
  },
  {
    id: "crypto",
    name: "Криптогород",
    aliases: ["криптогород"],
    rebirth: 7,
    fare: 15_000_000,
    note: "R7+, проезд 15M",
  },
  {
    id: "cosmo",
    name: "Космопорт",
    aliases: ["космопорт"],
    rebirth: 9,
    fare: 30_000_000,
    note: "R9+, проезд 30M",
  },
];

export function matchLocation(locationName) {
  const key = (locationName || "").trim().toLowerCase();
  if (!key) return null;
  return (
    LOCATIONS.find((l) => l.aliases.some((a) => key.includes(a) || a.includes(key))) ||
    null
  );
}

export function locationUnlocked(locationName, rebirth) {
  const loc = matchLocation(locationName);
  if (!loc) return true;
  return rebirth >= loc.rebirth;
}
