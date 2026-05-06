import migration001 from './001_initial.sql?raw';
import migration002 from './002_failsafe.sql?raw';
import migration003 from './003_bundles.sql?raw';
import migration004 from './004_palette_delivery.sql?raw';
import migration005 from './005_time_needed.sql?raw';
import migration006 from './006_supplier_sources.sql?raw';
import migration007 from './007_supplier_url_nullable.sql?raw';
import migration008 from './008_latex_full_palette.sql?raw';
import migration009 from './009_foil_topper_split.sql?raw';
import migration010 from './010_stylex_latex_colours.sql?raw';
import migration011 from './011_ops_foil_letters_numbers.sql?raw';
import migration012 from './012_supplier_source_photos.sql?raw';
import migration013 from './013_supplier_prices.sql?raw';
import migration014 from './014_stylex_latex_prices.sql?raw';
import migration015 from './015_misc_supplier_sources.sql?raw';
import migration016 from './016_orders_address.sql?raw';
import migration017 from './017_catalogue_category.sql?raw';
import migration018 from './018_stock_tracked.sql?raw';
import migration019 from './019_orders_rush.sql?raw';

export type Migration = { version: string; sql: string };

export const migrations: Migration[] = [
  { version: '001_initial', sql: migration001 },
  { version: '002_failsafe', sql: migration002 },
  { version: '003_bundles', sql: migration003 },
  { version: '004_palette_delivery', sql: migration004 },
  { version: '005_time_needed', sql: migration005 },
  { version: '006_supplier_sources', sql: migration006 },
  { version: '007_supplier_url_nullable', sql: migration007 },
  { version: '008_latex_full_palette', sql: migration008 },
  { version: '009_foil_topper_split', sql: migration009 },
  { version: '010_stylex_latex_colours', sql: migration010 },
  { version: '011_ops_foil_letters_numbers', sql: migration011 },
  { version: '012_supplier_source_photos', sql: migration012 },
  { version: '013_supplier_prices', sql: migration013 },
  { version: '014_stylex_latex_prices', sql: migration014 },
  { version: '015_misc_supplier_sources', sql: migration015 },
  { version: '016_orders_address', sql: migration016 },
  { version: '017_catalogue_category', sql: migration017 },
  { version: '018_stock_tracked', sql: migration018 },
  { version: '019_orders_rush', sql: migration019 },
];
