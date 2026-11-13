import React from 'react';

/** History column: an announcement's title and the start of its message in one language. */
export default function AnnouncementText({ property, record }) {
  const isArabic = property.path === 'title_ar';
  const title = record?.params?.[isArabic ? 'title_ar' : 'title_en'];
  const body = record?.params?.[isArabic ? 'body_ar' : 'body_en'];
  return (
    <div
      className={`pupzy-announcement-cell${isArabic ? ' pupzy-arabic' : ''}`}
      dir={isArabic ? 'rtl' : 'ltr'}
      lang={isArabic ? 'ar' : 'en'}
    >
      <strong>{title}</strong>
      <span>{body}</span>
    </div>
  );
}
