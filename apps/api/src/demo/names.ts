const ADJECTIVES = [
  'Swift',
  'Calm',
  'Bright',
  'Clever',
  'Brave',
  'Gentle',
  'Lucky',
  'Nimble',
  'Quiet',
  'Sunny',
  'Witty',
  'Bold',
  'Cosmic',
  'Daring',
  'Eager',
  'Fuzzy',
  'Jolly',
  'Mellow',
  'Plucky',
  'Zesty',
];
const ANIMALS = [
  'Otter',
  'Falcon',
  'Panda',
  'Fox',
  'Heron',
  'Lynx',
  'Koala',
  'Orca',
  'Badger',
  'Gecko',
  'Puffin',
  'Bison',
  'Ibex',
  'Marten',
  'Narwhal',
  'Quokka',
  'Raven',
  'Tapir',
  'Walrus',
  'Yak',
];

function pick<T>(items: readonly T[], random: () => number): T {
  return items[Math.floor(random() * items.length)] as T;
}

/** Friendly random name for a guest, e.g. "Swift Otter". */
export function guestName(random: () => number = Math.random): string {
  return `${pick(ADJECTIVES, random)} ${pick(ANIMALS, random)}`;
}
