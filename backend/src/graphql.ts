
/*
 * -------------------------------------------------------
 * THIS FILE WAS AUTOMATICALLY GENERATED (DO NOT MODIFY)
 * -------------------------------------------------------
 */

/* tslint:disable */
/* eslint-disable */

export enum PostType {
    RESCUE = "RESCUE",
    LOST = "LOST",
    ADOPTION = "ADOPTION",
    PRODUCT = "PRODUCT"
}

export enum LostFoundType {
    LOST_PET = "LOST_PET",
    FOUND_STRAY = "FOUND_STRAY"
}

export enum PostStatus {
    ACTIVE = "ACTIVE",
    RESOLVED = "RESOLVED",
    REUNITED = "REUNITED",
    ADOPTED = "ADOPTED",
    SOLD = "SOLD",
    REMOVED = "REMOVED"
}

export enum ModerationStatus {
    PENDING_AUTO_REVIEW = "PENDING_AUTO_REVIEW",
    CLEAN = "CLEAN",
    FLAGGED = "FLAGGED"
}

export enum UrgencyTier {
    CRITICAL = "CRITICAL",
    URGENT = "URGENT",
    MODERATE = "MODERATE"
}

export enum SpeciesType {
    DOG = "DOG",
    CAT = "CAT",
    BIRD = "BIRD",
    RABBIT = "RABBIT",
    OTHER = "OTHER"
}

export enum GenderType {
    MALE = "MALE",
    FEMALE = "FEMALE",
    UNKNOWN = "UNKNOWN"
}

export enum AgeUnit {
    DAYS = "DAYS",
    WEEKS = "WEEKS",
    MONTHS = "MONTHS",
    YEARS = "YEARS"
}

export enum ReporterRole {
    REPORTING = "REPORTING",
    ON_SITE = "ON_SITE",
    CAN_TRANSPORT = "CAN_TRANSPORT"
}

export enum FoundAnimalCondition {
    HEALTHY = "HEALTHY",
    INJURED = "INJURED",
    UNKNOWN = "UNKNOWN"
}

export enum SpaceRequirement {
    APARTMENT_OK = "APARTMENT_OK",
    NEEDS_YARD = "NEEDS_YARD",
    NEEDS_FARM_OR_LARGE_SPACE = "NEEDS_FARM_OR_LARGE_SPACE"
}

export enum LivingSituation {
    APARTMENT = "APARTMENT",
    HOUSE_WITH_YARD = "HOUSE_WITH_YARD",
    FARM = "FARM",
    OTHER = "OTHER"
}

export enum ProductCategory {
    CARE = "CARE",
    FOOD = "FOOD",
    TRANSPORT = "TRANSPORT",
    ACCESSORIES = "ACCESSORIES",
    GROOMING = "GROOMING",
    MEDICAL_SUPPLIES = "MEDICAL_SUPPLIES",
    OTHER = "OTHER"
}

export enum ProductCondition {
    NEW = "NEW",
    LIKE_NEW = "LIKE_NEW",
    USED = "USED"
}

export enum RequestStatus {
    PENDING = "PENDING",
    APPROVED = "APPROVED",
    REJECTED = "REJECTED"
}

export enum ReportReason {
    UNRELATED_TO_ANIMALS = "UNRELATED_TO_ANIMALS",
    SPAM = "SPAM",
    INAPPROPRIATE_CONTENT = "INAPPROPRIATE_CONTENT",
    SCAM = "SCAM",
    DUPLICATE = "DUPLICATE",
    OTHER = "OTHER"
}

export enum NotificationType {
    NEW_UPVOTE = "NEW_UPVOTE",
    POST_SAVED = "POST_SAVED",
    CONTACT_REQUEST_RECEIVED = "CONTACT_REQUEST_RECEIVED",
    CONTACT_REQUEST_APPROVED = "CONTACT_REQUEST_APPROVED",
    CONTACT_REQUEST_REJECTED = "CONTACT_REQUEST_REJECTED",
    ADOPTION_APPLICATION_RECEIVED = "ADOPTION_APPLICATION_RECEIVED",
    ADOPTION_APPLICATION_APPROVED = "ADOPTION_APPLICATION_APPROVED",
    ADOPTION_APPLICATION_REJECTED = "ADOPTION_APPLICATION_REJECTED",
    POST_REMOVED_BY_ADMIN = "POST_REMOVED_BY_ADMIN",
    POST_INACTIVITY_NUDGE = "POST_INACTIVITY_NUDGE",
    SYSTEM_ANNOUNCEMENT = "SYSTEM_ANNOUNCEMENT"
}

export enum PersonalityTag {
    PLAYFUL = "PLAYFUL",
    GENTLE = "GENTLE",
    INDOOR = "INDOOR",
    OUTDOOR = "OUTDOOR",
    GOOD_WITH_KIDS = "GOOD_WITH_KIDS",
    GOOD_WITH_CATS = "GOOD_WITH_CATS",
    GOOD_WITH_DOGS = "GOOD_WITH_DOGS",
    SHY = "SHY",
    ENERGETIC = "ENERGETIC",
    CALM = "CALM"
}

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
    nameEnglish: string;
    nameArabic: string;
    governorate: string;
}

export interface IQuery {
    cities(): City[] | Promise<City[]>;
    me(): User | Promise<User>;
}

export interface GeoLocation {
    latitude: number;
    longitude: number;
}

export interface PostMedia {
    id: string;
    publicUrl: string;
    displayOrder: number;
    fileContentType?: Nullable<string>;
    width?: Nullable<number>;
    height?: Nullable<number>;
}

export interface Post {
    id: string;
    creator: User;
    postType: PostType;
    title: string;
    description: string;
    status: PostStatus;
    moderationStatus: ModerationStatus;
    urgency?: Nullable<UrgencyTier>;
    city: City;
    areaName?: Nullable<string>;
    coordinates?: Nullable<GeoLocation>;
    marketCategory?: Nullable<ProductCategory>;
    upvoteCount: number;
    saveCount: number;
    viewCount: number;
    effectiveScore: number;
    media: PostMedia[];
    createdAt: DateTime;
    updatedAt: DateTime;
}

export interface RescuePost {
    postId: string;
    species: SpeciesType;
    conditionSummary: string;
    reporterRole: ReporterRole;
}

export interface LostPost {
    postId: string;
    reportType: LostFoundType;
    species: SpeciesType;
    breed?: Nullable<string>;
    colorAndMarkings?: Nullable<string>;
    hasCollarWithIdentificationTag?: Nullable<boolean>;
    circumstances?: Nullable<string>;
    petName?: Nullable<string>;
    dateLastSeen?: Nullable<string>;
    currentCondition?: Nullable<FoundAnimalCondition>;
    isCurrentlySafeWithReporter?: Nullable<boolean>;
    dateFound?: Nullable<string>;
}

export interface AdoptionPost {
    postId: string;
    petName: string;
    species: SpeciesType;
    breed?: Nullable<string>;
    ageValue?: Nullable<number>;
    ageUnit?: Nullable<AgeUnit>;
    gender: GenderType;
    vaccinated: boolean;
    neutered: boolean;
    healthNotes?: Nullable<string>;
    personalityTags: PersonalityTag[];
    spaceRequirement?: Nullable<SpaceRequirement>;
    priorPetExperienceRequired: boolean;
    additionalRequirements?: Nullable<string>;
    currentlyWith?: Nullable<string>;
}

export interface ProductPost {
    postId: string;
    category: ProductCategory;
    condition: ProductCondition;
    priceAmount?: Nullable<number>;
    priceCurrency: string;
    isFree: boolean;
    openToOffers: boolean;
}

export interface ContactRequest {
    id: string;
    postId: string;
    requester: User;
    message: string;
    status: RequestStatus;
    whatsappLink?: Nullable<string>;
    respondedAt?: Nullable<DateTime>;
    createdAt: DateTime;
}

export interface AdoptionApplication {
    id: string;
    targetPostId: string;
    applicant: User;
    status: RequestStatus;
    speciesPreference?: Nullable<SpeciesType>;
    breedPreference?: Nullable<string>;
    agePreference?: Nullable<string>;
    genderPreference?: Nullable<GenderType>;
    livingSituation: LivingSituation;
    hasOutdoorAccess: boolean;
    hasOtherPetsAtHome: boolean;
    hasChildrenAtHome: boolean;
    hoursAtHomePerDay?: Nullable<number>;
    previousPetExperience?: Nullable<string>;
    whyAdopt: string;
    consentHomeVisit: boolean;
    canProvideVetReference: boolean;
    respondedAt?: Nullable<DateTime>;
    createdAt: DateTime;
}

export interface PostReport {
    id: string;
    postId: string;
    reason: ReportReason;
    details?: Nullable<string>;
    createdAt: DateTime;
}

export interface Notification {
    id: string;
    type: NotificationType;
    title: string;
    body: string;
    relatedPostId?: Nullable<string>;
    isRead: boolean;
    createdAt: DateTime;
}

export interface SavedSearch {
    id: string;
    label?: Nullable<string>;
    postType: PostType;
    cityId?: Nullable<string>;
    species?: Nullable<SpeciesType>;
    breed?: Nullable<string>;
    marketCategory?: Nullable<ProductCategory>;
    maxPrice?: Nullable<number>;
    createdAt: DateTime;
}

export interface User {
    id: string;
    email: string;
    fullName?: Nullable<string>;
    fullNameArabic?: Nullable<string>;
    profilePictureUrl?: Nullable<string>;
    isVerified: boolean;
    phoneNumber?: Nullable<string>;
    profileComplete: boolean;
    homeCityId?: Nullable<string>;
    city?: Nullable<City>;
    postCount: number;
    rescuePostCount: number;
    lostPostCount: number;
    adoptionPostCount: number;
    productPostCount: number;
    languagePreference?: Nullable<string>;
    notificationsEnabled: boolean;
    lastSeenAt?: Nullable<DateTime>;
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
