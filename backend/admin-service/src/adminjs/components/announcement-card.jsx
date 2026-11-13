import React from 'react';

/** The megaphone the app shows for an Announcement (`Icons.campaign_outlined`). */
function CampaignIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M3 11v2a1 1 0 0 0 1 1h2l4 3.5V6.5L6 10H4a1 1 0 0 0-1 1Zm13.5 1a4 4 0 0 0-2-3.46v6.92a4 4 0 0 0 2-3.46ZM14.5 4.2v1.55A6.5 6.5 0 0 1 14.5 18.25V19.8A8 8 0 0 0 14.5 4.2Z"
        fill="currentColor"
      />
    </svg>
  );
}

/**
 * One announcement drawn the way a recipient sees it in the app's notification
 * inbox: icon, title, full message, time. `language` is the recipient's
 * language; Arabic is laid out right to left in the Arabic typeface.
 */
export default function AnnouncementCard({ language, title, body, caption, testId }) {
  const isArabic = language === 'ar';
  return (
    <figure className="pupzy-announcement-card-figure" data-testid={testId}>
      {caption ? <figcaption className="pupzy-announcement-card-caption">{caption}</figcaption> : null}
      <div
        className={`pupzy-announcement-card${isArabic ? ' pupzy-arabic' : ''}`}
        dir={isArabic ? 'rtl' : 'ltr'}
        lang={isArabic ? 'ar' : 'en'}
      >
        <span className="pupzy-announcement-card-icon">
          <CampaignIcon />
        </span>
        <div className="pupzy-announcement-card-content">
          <p className="pupzy-announcement-card-title" data-testid={testId ? `${testId}-title` : undefined}>
            {title || (isArabic ? 'العنوان' : 'Title')}
          </p>
          <p className="pupzy-announcement-card-body" data-testid={testId ? `${testId}-body` : undefined}>
            {body || (isArabic ? 'نص الرسالة' : 'Message')}
          </p>
          <p className="pupzy-announcement-card-time">{isArabic ? 'الآن' : 'Just now'}</p>
        </div>
      </div>
    </figure>
  );
}
