/** Animal and bird names used when filling seats with bots. */
export const BOT_NAMES = [
  'Falcon',
  'Hawk',
  'Eagle',
  'Owl',
  'Raven',
  'Robin',
  'Sparrow',
  'Heron',
  'Osprey',
  'Kiwi',
  'Crane',
  'Swan',
  'Wren',
  'Finch',
  'Dove',
  'Jay',
  'Lark',
  'Tern',
  'Ibis',
  'Puffin',
  'Panda',
  'Tiger',
  'Lion',
  'Wolf',
  'Fox',
  'Otter',
  'Bear',
  'Moose',
  'Lynx',
  'Puma',
  'Koala',
  'Cobra',
  'Gecko',
  'Ibex',
  'Seal',
  'Whale',
  'Bison',
  'Badger',
  'Beaver',
  'Camel',
  'Deer',
  'Elk',
  'Hare',
  'Jaguar',
  'Lemur',
  'Orca',
  'Mink',
  'Quail',
  'Stork',
  'Toucan',
] as const

function randomIndex(length: number) {
  return crypto.getRandomValues(new Uint32Array(1))[0] % length
}

/** Pick a bot name that is not already used in this room. */
export function pickUniqueBotName(usedNames: Iterable<string>) {
  const taken = new Set(
    [...usedNames].map((name) => name.trim().toLowerCase()),
  )
  const free = BOT_NAMES.filter((name) => !taken.has(name.toLowerCase()))
  const pool = free.length > 0 ? free : BOT_NAMES
  return pool[randomIndex(pool.length)]
}
