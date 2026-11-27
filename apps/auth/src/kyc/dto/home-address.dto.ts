import { Transform } from 'class-transformer';
import { IsIn, IsString, Length } from 'class-validator';

// Must match the app's list.
export const NIGERIAN_STATES = [
  'Abia',
  'Adamawa',
  'Akwa Ibom',
  'Anambra',
  'Bauchi',
  'Bayelsa',
  'Benue',
  'Borno',
  'Cross River',
  'Delta',
  'Ebonyi',
  'Edo',
  'Ekiti',
  'Enugu',
  'FCT',
  'Gombe',
  'Imo',
  'Jigawa',
  'Kaduna',
  'Kano',
  'Katsina',
  'Kebbi',
  'Kogi',
  'Kwara',
  'Lagos',
  'Nasarawa',
  'Niger',
  'Ogun',
  'Ondo',
  'Osun',
  'Oyo',
  'Plateau',
  'Rivers',
  'Sokoto',
  'Taraba',
  'Yobe',
  'Zamfara',
] as const;

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value;

// The customer's home address, entered with their proof of address. Shared
// with StableStack, which needs it before it pays naira out.
export class HomeAddressDto {
  @Transform(trim)
  @IsString()
  @Length(5, 150)
  address!: string;

  @Transform(trim)
  @IsString()
  @Length(2, 60)
  lga!: string;

  @IsIn(NIGERIAN_STATES)
  state!: (typeof NIGERIAN_STATES)[number];
}

export type HomeAddress = Pick<HomeAddressDto, 'address' | 'lga' | 'state'>;
