/*
 * -------------------------------------------------------
 * THIS FILE WAS AUTOMATICALLY GENERATED (DO NOT MODIFY)
 * -------------------------------------------------------
 */

/* tslint:disable */
/* eslint-disable */

export interface CompleteProfileInput {
  fullName: string;
  phoneNumber: string;
  cityId?: Nullable<string>;
  location?: Nullable<GeoLocationInput>;
}

export interface GeoLocationInput {
  latitude: number;
  longitude: number;
}

export interface UpdateProfileInput {
  fullName: string;
  phoneNumber?: Nullable<string>;
}

export interface City {
  id: string;
  nameEn: string;
  nameAr: string;
  governorate: string;
}

export interface IQuery {
  cities(): City[] | Promise<City[]>;
  me(): User | Promise<User>;
}

export interface User {
  id: string;
  email: string;
  fullName?: Nullable<string>;
  profilePictureUrl?: Nullable<string>;
  authProvider: string;
  isVerified: boolean;
  phoneNumber?: Nullable<string>;
  profileComplete: boolean;
  cityId?: Nullable<string>;
  city?: Nullable<City>;
  fullNameArabic?: Nullable<string>;
  rescuesCount: number;
  adoptedCount: number;
  helpingCount: number;
  languagePreference?: Nullable<string>;
  notificationsEnabled: boolean;
  privacyLevel: string;
  createdAt: DateTime;
  updatedAt: DateTime;
}

export interface IMutation {
  completeProfile(input: CompleteProfileInput): User | Promise<User>;
  updateProfile(input: UpdateProfileInput): User | Promise<User>;
  updateMyLocation(location: GeoLocationInput): User | Promise<User>;
}

export type DateTime = any;
type Nullable<T> = T | null;
