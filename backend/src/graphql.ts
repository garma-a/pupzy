
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
    cityId: string;
}

export interface UpdateProfileInput {
    fullName: string;
}

export interface User {
    id: string;
    email: string;
    fullName?: Nullable<string>;
    profilePictureUrl?: Nullable<string>;
    authProvider: string;
    isVerified: boolean;
    phoneNumber?: Nullable<string>;
    cityId?: Nullable<string>;
    fullNameArabic?: Nullable<string>;
    rescuesCount: number;
    adoptedCount: number;
    helpingCount: number;
    languagePreference: string;
    notificationsEnabled: boolean;
    privacyLevel: string;
    createdAt: DateTime;
    updatedAt: DateTime;
}

export interface IQuery {
    me(): User | Promise<User>;
}

export interface IMutation {
    completeProfile(input: CompleteProfileInput): User | Promise<User>;
    updateProfile(input: UpdateProfileInput): User | Promise<User>;
}

export type DateTime = any;
type Nullable<T> = T | null;
