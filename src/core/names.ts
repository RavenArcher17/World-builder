import type { Rng } from './rng';

const START = [
  'Ash', 'Bar', 'Bel', 'Bran', 'Cal', 'Dun', 'Eld', 'Fal', 'Glen', 'Grim', 'Hal', 'Hart', 'Iron', 'Kel', 'Lind',
  'Mar', 'Mor', 'Nor', 'Oak', 'Pen', 'Raven', 'Red', 'Ros', 'Stone', 'Thorn', 'Wester', 'Wil', 'Win', 'Wolf',
  'Yar', 'Ald', 'Brig', 'Cor', 'Dra', 'Ever', 'Fen', 'Gal', 'Hol', 'Kings', 'Lor', 'Mill', 'North', 'Ost',
  'Quel', 'Sil', 'Tal', 'Ul', 'Vel', 'Whit', 'Black', 'Elder', 'Frost', 'Gold', 'High', 'Low', 'Summer', 'Amber',
];
const MID = ['', '', '', '', 'a', 'e', 'i', 'o', 'en', 'an', 'er', 'ing', 'el'];
const END = [
  'ton', 'bury', 'wick', 'ham', 'stead', 'vale', 'holm', 'by', 'dale', 'field', 'gate', 'moor', 'shire', 'stow',
  'thorpe', 'well', 'worth', 'fall', 'keep', 'den', 'ley', 'mont', 'burgh', 'cester',
];
const END_RIVER = ['ford', 'bridge', 'brook', 'mere', 'water', 'bourne'];
const END_COAST = ['port', 'haven', 'mouth', 'strand', 'cove', 'bay'];
const END_HILL = ['ridge', 'crest', 'hill', 'tor', 'peak'];
const END_FOREST = ['wood', 'glen', 'grove', 'hurst', 'shaw'];

export interface NameHints {
  river?: boolean;
  coast?: boolean;
  hills?: boolean;
  forest?: boolean;
}

export function placeName(rng: Rng, hints: NameHints = {}): string {
  let ends = END;
  if (hints.coast && rng.chance(0.6)) ends = END_COAST;
  else if (hints.river && rng.chance(0.5)) ends = END_RIVER;
  else if (hints.hills && rng.chance(0.4)) ends = END_HILL;
  else if (hints.forest && rng.chance(0.4)) ends = END_FOREST;
  const a = rng.pick(START);
  const m = rng.pick(MID);
  const e = rng.pick(ends);
  const name = a + (a.endsWith(m) ? '' : m) + e;
  return name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
}

const ADJ = ['Sunken', 'Forgotten', 'Black', 'Howling', 'Shattered', 'Weeping', 'Hollow', 'Crimson', 'Silent', 'Drowned', 'Ashen', 'Cursed', 'Whispering', 'Iron', 'Bone'];
const DUNGEON_NOUN = ['Crypt', 'Vault', 'Catacombs', 'Halls', 'Pits', 'Labyrinth', 'Barrow', 'Tomb', 'Delve', 'Warrens', 'Sanctum', 'Depths'];
const CAVE_NOUN = ['Cave', 'Hollow', 'Grotto', 'Caverns', 'Chasm', 'Den'];
const MONSTERS = ['Dragon', 'Wyvern', 'Troll', 'Basilisk', 'Hydra', 'Ogre', 'Owlbear', 'Manticore', 'Giant Spider', 'Wyrm', 'Chimera'];
const CAMPS = ['Bandit', 'Orc', 'Goblin', 'Gnoll', 'Hunters\'', 'Mercenary', 'Nomad'];
const LANDMARKS = ['Standing Stones', 'Old Oak', 'Giant\'s Seat', 'Witch\'s Circle', 'Broken Obelisk', 'Weeping Statue', 'Skull Rock', 'Hanging Tree', 'Moon Pool'];
const DEITIES = ['Dawn', 'Seven Stars', 'Moon', 'Storm', 'Harvest', 'Silent Flame', 'Deep', 'Ever-Watching Eye', 'Lady of Mercy', 'Forge'];
const TAVERN_ADJ = ['Prancing', 'Golden', 'Rusty', 'Sleeping', 'Drunken', 'Laughing', 'Silver', 'Green', 'Jolly', 'Wandering', 'Crooked', 'Salty'];
const TAVERN_NOUN = ['Pony', 'Goose', 'Anchor', 'Dragon', 'Boar', 'Griffin', 'Mermaid', 'Lantern', 'Stag', 'Barrel', 'Fox', 'Kettle'];
const SURNAMES = ['Ashford', 'Bramble', 'Cobb', 'Dunmore', 'Fletcher', 'Grey', 'Hale', 'Ironside', 'Marsh', 'Oakes', 'Pike', 'Stone', 'Thatcher', 'Wren'];

/** A fitting name for any feature type. */
export function featureName(rng: Rng, type: string, hints: NameHints = {}): string {
  switch (type) {
    case 'capital':
    case 'city':
    case 'town':
    case 'village':
    case 'hamlet':
      return placeName(rng, hints);
    case 'farm':
      return `${rng.pick(SURNAMES)} Farm`;
    case 'castle':
      return `${placeName(rng, hints)} ${rng.pick(['Castle', 'Keep', 'Hold', 'Citadel'])}`;
    case 'dungeon':
      return `The ${rng.pick(ADJ)} ${rng.pick(DUNGEON_NOUN)}`;
    case 'ruins':
      return `Ruins of ${placeName(rng)}`;
    case 'cave':
      return `${rng.pick(ADJ)} ${rng.pick(CAVE_NOUN)}`;
    case 'tower':
      return `Tower of the ${rng.pick(ADJ)} ${rng.pick(['Mage', 'Star', 'Eye', 'Flame', 'Watcher'])}`;
    case 'temple':
    case 'temple_bldg':
      return `Temple of the ${rng.pick(DEITIES)}`;
    case 'shrine':
      return `Shrine of the ${rng.pick(DEITIES)}`;
    case 'mine':
      return `${placeName(rng)} ${rng.pick(['Mine', 'Delvings', 'Quarry'])}`;
    case 'lair':
      return `${rng.pick(MONSTERS)} Lair`;
    case 'camp':
      return `${rng.pick(CAMPS)} Camp`;
    case 'landmark':
      return `The ${rng.pick(LANDMARKS)}`;
    case 'inn':
    case 'tavern':
    case 'inn_bldg':
      return `The ${rng.pick(TAVERN_ADJ)} ${rng.pick(TAVERN_NOUN)}`;
    case 'smithy':
      return `${rng.pick(SURNAMES)} Smithy`;
    case 'shop':
      return `${rng.pick(SURNAMES)}'s ${rng.pick(['General Goods', 'Provisions', 'Curios', 'Outfitters', 'Tailoring', 'Bakery'])}`;
    case 'guildhall':
      return `${rng.pick(['Merchants', 'Masons', 'Weavers', 'Adventurers', 'Thieves'])}' Guild`;
    case 'alchemist':
      return `${rng.pick(SURNAMES)}'s Potions`;
    case 'library':
      return `${rng.pick(['Grand', 'Old', 'Arcane', 'Royal'])} Library`;
    case 'keep':
      return `${rng.pick(SURNAMES)} Keep`;
    default:
      return '';
  }
}
