/**
 * Plain-words labels for columns, shared by every resource. Foreign keys drop
 * the trailing "Id" so a column reads "Post" or "Reported by".
 */
export const PROPERTY_LABELS = Object.freeze({
  id: 'ID',
  review_status: 'Status',
  post_id: 'Post',
  target_post_id: 'Post',
  related_post_id: 'Related Post',
  comment_id: 'Comment',
  parent_id: 'Parent Comment',
  author_id: 'Author',
  reporter_id: 'Reported by',
  reported_user_id: 'Reported account',
  reviewed_by_admin_id: 'Reviewed by',
  moderated_by_admin_id: 'Moderated by',
  banned_by_admin_id: 'Banned by',
  admin_user_id: 'Admin',
  recipient_id: 'Recipient',
  requester_id: 'Requester',
  applicant_id: 'Applicant',
  user_id: 'User',
  creator_id: 'Owner',
  target_id: 'Target',
  source_id: 'Source',
  vet_clinic_id: 'Vet Clinic',
  related_contact_request_id: 'Related Contact Request',
  related_application_id: 'Related Application',
  city_id: 'City',
  home_city_id: 'Home City',
  selected_city_id: 'Selected City',
  nearest_city_id: 'Nearest City',
});
