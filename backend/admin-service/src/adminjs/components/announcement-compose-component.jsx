import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ApiClient, ViewHelpers, useNotice } from 'adminjs';
import { useNavigate } from 'react-router';
import { Button } from '@adminjs/design-system';

import AnnouncementCard from './announcement-card.jsx';
import { BODY_MAX_LENGTH, TITLE_MAX_LENGTH, characterCount } from './announcement-limits.js';

const api = new ApiClient();
const helpers = new ViewHelpers();

const EMPTY_FORM = { titleEn: '', bodyEn: '', titleAr: '', bodyAr: '', audience: 'ALL', cityId: '', cityName: '' };
const STEPS = [
  { id: 'compose', label: 'Compose' },
  { id: 'preview', label: 'Preview' },
  { id: 'confirm', label: 'Confirm' },
];

const formatCount = (value) => Number(value).toLocaleString('en-US');
const usersLabel = (count) => `${formatCount(count)} ${count === 1 ? 'user' : 'users'}`;

function draftPayload(form) {
  const { cityName: _cityName, ...draft } = form;
  return draft;
}

function Stepper({ step }) {
  const current = STEPS.findIndex((candidate) => candidate.id === step);
  return (
    <ol className="pupzy-announcement-steps" aria-label="Progress">
      {STEPS.map((candidate, index) => (
        <li
          key={candidate.id}
          data-state={index < current ? 'done' : index === current ? 'current' : 'todo'}
          aria-current={index === current ? 'step' : undefined}
        >
          <span className="pupzy-announcement-step-number">{index + 1}</span>
          {candidate.label}
        </li>
      ))}
    </ol>
  );
}

function Counter({ value, max, id }) {
  const used = characterCount(value);
  return (
    <span
      id={id}
      className="pupzy-announcement-counter"
      data-over={used > max ? 'true' : 'false'}
      aria-live="polite"
      data-testid={`${id}`}
    >
      {used} / {max}
    </span>
  );
}

function TextField({ id, label, value, onChange, error, max, multiline, rtl, hint }) {
  const Input = multiline ? 'textarea' : 'input';
  return (
    <div className="pupzy-announcement-field" data-invalid={error ? 'true' : 'false'}>
      <label htmlFor={id}>{label}</label>
      <Input
        id={id}
        data-testid={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        dir={rtl ? 'rtl' : 'ltr'}
        lang={rtl ? 'ar' : 'en'}
        className={rtl ? 'pupzy-arabic' : undefined}
        aria-invalid={error ? 'true' : 'false'}
        aria-describedby={`${id}-counter${error ? ` ${id}-error` : ''}`}
        rows={multiline ? 6 : undefined}
        type={multiline ? undefined : 'text'}
        autoComplete="off"
      />
      <div className="pupzy-announcement-field-footer">
        {error ? (
          <span id={`${id}-error`} role="alert" className="pupzy-announcement-error" data-testid={`${id}-error`}>
            {error}
          </span>
        ) : (
          <span className="pupzy-announcement-hint">{hint}</span>
        )}
        <Counter id={`${id}-counter`} value={value} max={max} />
      </div>
    </div>
  );
}

function CityPicker({ form, setForm, error }) {
  const [query, setQuery] = useState('');
  const [options, setOptions] = useState([]);
  const [open, setOpen] = useState(false);
  const timer = useRef(null);

  const search = useCallback((text) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try {
        const records = await api.searchRecords({ resourceId: 'cities', query: text });
        setOptions(records ?? []);
      } catch {
        setOptions([]);
      }
    }, 200);
  }, []);

  useEffect(() => () => clearTimeout(timer.current), []);

  if (form.cityId) {
    return (
      <div className="pupzy-announcement-field" data-invalid="false">
        <span className="pupzy-announcement-label">City</span>
        <div className="pupzy-announcement-chip" data-testid="announcement-city-selected">
          <span>{form.cityName}</span>
          <button
            type="button"
            aria-label="Choose a different City"
            onClick={() => setForm({ ...form, cityId: '', cityName: '' })}
          >
            Change
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="pupzy-announcement-field" data-invalid={error ? 'true' : 'false'}>
      <label htmlFor="announcement-city-search">City</label>
      <input
        id="announcement-city-search"
        data-testid="announcement-city-search"
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls="announcement-city-options"
        aria-invalid={error ? 'true' : 'false'}
        autoComplete="off"
        placeholder="Search for a City"
        value={query}
        onFocus={() => {
          setOpen(true);
          search(query);
        }}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
          search(event.target.value);
        }}
      />
      {open && options.length > 0 ? (
        <ul id="announcement-city-options" role="listbox" className="pupzy-announcement-options">
          {options.map((option) => (
            <li key={option.id} role="option" aria-selected="false">
              <button
                type="button"
                data-testid="announcement-city-option"
                onClick={() => {
                  setForm({ ...form, cityId: option.id, cityName: option.title });
                  setOpen(false);
                }}
              >
                {option.title}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {error ? (
        <span role="alert" className="pupzy-announcement-error" data-testid="announcement-city-error">
          {error}
        </span>
      ) : null}
    </div>
  );
}

function audienceSummary(form, preview) {
  return form.audience === 'CITY' ? `Users in ${preview?.cityName ?? form.cityName}` : 'All users';
}

/**
 * New announcement: compose (English and Arabic) -> preview as a notification
 * card -> confirm with the exact recipient count -> send. Validation and the
 * count come from the server (the shared contract), so what an administrator
 * confirms is exactly what the fan-out will use.
 */
export default function AnnouncementCompose({ resource }) {
  const addNotice = useNotice();
  const navigate = useNavigate();
  const [step, setStep] = useState('compose');
  const [form, setForm] = useState(EMPTY_FORM);
  const [errors, setErrors] = useState({});
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [stale, setStale] = useState(null);

  const set = (field) => (value) => {
    setForm((previous) => ({ ...previous, [field]: value }));
    setErrors((previous) => (previous[field] ? { ...previous, [field]: undefined } : previous));
  };

  const check = async () => {
    setBusy(true);
    try {
      const response = await api.resourceAction({
        resourceId: resource.id,
        actionName: 'previewAnnouncement',
        method: 'post',
        data: draftPayload(form),
      });
      const result = response.data;
      if (!result.ok) {
        setErrors(result.errors ?? {});
        if (!result.errors) addNotice(result.notice ?? { message: 'Could not check the announcement.', type: 'error' });
        return null;
      }
      setErrors({});
      setPreview(result);
      return result;
    } catch {
      addNotice({ message: 'Could not check the announcement. Try again.', type: 'error' });
      return null;
    } finally {
      setBusy(false);
    }
  };

  const toPreview = async () => {
    if (await check()) setStep('preview');
  };

  const toConfirm = async () => {
    setStale(null);
    if (await check()) setStep('confirm');
  };

  const send = async () => {
    setBusy(true);
    try {
      const response = await api.resourceAction({
        resourceId: resource.id,
        actionName: 'new',
        method: 'post',
        data: { ...draftPayload(form), confirmedCount: preview.count },
      });
      const result = response.data;
      if (result.ok) {
        addNotice(result.notice);
        navigate(helpers.recordActionUrl({ resourceId: resource.id, recordId: result.id, actionName: 'show' }));
        return;
      }
      if (result.currentCount !== undefined) {
        setStale({ message: result.error, count: result.currentCount });
        setPreview((previous) => ({ ...previous, count: result.currentCount }));
      } else if (result.errors) {
        setErrors(result.errors);
        setStep('compose');
      } else {
        addNotice(result.notice ?? { message: 'The announcement was not sent.', type: 'error' });
      }
    } catch {
      addNotice({ message: 'The announcement was not sent. Try again.', type: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="pupzy-announcement" data-testid="announcement-compose" data-step={step}>
      <header className="pupzy-announcement-header">
        <p>
          A message to every eligible user, or to the users of one City. It is delivered in each user&apos;s language
          and cannot be edited or unsent once it is sent.
        </p>
      </header>
      <Stepper step={step} />

      {step === 'compose' ? (
        <form
          className="pupzy-announcement-form"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void toPreview();
          }}
        >
          <div className="pupzy-announcement-languages">
            <section aria-labelledby="announcement-english-heading" className="pupzy-card pupzy-announcement-panel">
              <h3 id="announcement-english-heading">English</h3>
              <TextField
                id="announcement-title-en"
                label="Title"
                value={form.titleEn}
                onChange={set('titleEn')}
                error={errors.titleEn}
                max={TITLE_MAX_LENGTH}
                hint="Shown as the notification headline."
              />
              <TextField
                id="announcement-body-en"
                label="Message"
                value={form.bodyEn}
                onChange={set('bodyEn')}
                error={errors.bodyEn}
                max={BODY_MAX_LENGTH}
                multiline
                hint="Opens in full when a user taps the notification."
              />
            </section>
            <section aria-labelledby="announcement-arabic-heading" className="pupzy-card pupzy-announcement-panel">
              <h3 id="announcement-arabic-heading" dir="rtl" lang="ar" className="pupzy-arabic">
                العربية
              </h3>
              <TextField
                id="announcement-title-ar"
                label="Title (Arabic)"
                value={form.titleAr}
                onChange={set('titleAr')}
                error={errors.titleAr}
                max={TITLE_MAX_LENGTH}
                rtl
                hint="Shown to users whose language is Arabic."
              />
              <TextField
                id="announcement-body-ar"
                label="Message (Arabic)"
                value={form.bodyAr}
                onChange={set('bodyAr')}
                error={errors.bodyAr}
                max={BODY_MAX_LENGTH}
                multiline
                rtl
                hint="Right to left."
              />
            </section>
          </div>

          <section className="pupzy-card pupzy-announcement-panel" aria-labelledby="announcement-audience-heading">
            <h3 id="announcement-audience-heading">Who receives it</h3>
            <fieldset className="pupzy-announcement-audience">
              <legend className="pupzy-visually-hidden">Audience</legend>
              <label>
                <input
                  type="radio"
                  name="announcement-audience"
                  data-testid="announcement-audience-all"
                  checked={form.audience === 'ALL'}
                  onChange={() => setForm({ ...form, audience: 'ALL', cityId: '', cityName: '' })}
                />
                All users
              </label>
              <label>
                <input
                  type="radio"
                  name="announcement-audience"
                  data-testid="announcement-audience-city"
                  checked={form.audience === 'CITY'}
                  onChange={() => setForm({ ...form, audience: 'CITY' })}
                />
                Users in one City
              </label>
            </fieldset>
            {form.audience === 'CITY' ? <CityPicker form={form} setForm={setForm} error={errors.cityId} /> : null}
            {errors.audience ? (
              <span role="alert" className="pupzy-announcement-error">
                {errors.audience}
              </span>
            ) : null}
            <p className="pupzy-announcement-hint">
              Banned and deleted accounts never receive it. Everyone else gets it in the app; push goes only to users
              who have notifications on.
            </p>
          </section>

          <div className="pupzy-announcement-actions">
            <Button type="submit" variant="primary" data-testid="announcement-preview" disabled={busy}>
              {busy ? 'Checking…' : 'Preview'}
            </Button>
          </div>
        </form>
      ) : null}

      {step === 'preview' && preview ? (
        <section className="pupzy-announcement-step" aria-labelledby="announcement-preview-heading">
          <h3 id="announcement-preview-heading">This is how it looks to each user</h3>
          <div className="pupzy-announcement-previews">
            <AnnouncementCard
              language="en"
              title={form.titleEn.trim()}
              body={form.bodyEn.trim()}
              caption="Users whose language is English (the default)"
              testId="announcement-preview-en"
            />
            <AnnouncementCard
              language="ar"
              title={form.titleAr.trim()}
              body={form.bodyAr.trim()}
              caption="Users whose language is Arabic"
              testId="announcement-preview-ar"
            />
          </div>
          <p className="pupzy-announcement-summary" data-testid="announcement-preview-audience">
            Audience: <strong>{audienceSummary(form, preview)}</strong>
          </p>
          <div className="pupzy-announcement-actions">
            <Button type="button" variant="text" data-testid="announcement-back" onClick={() => setStep('compose')}>
              Back to edit
            </Button>
            <Button
              type="button"
              variant="primary"
              data-testid="announcement-continue"
              disabled={busy}
              onClick={() => void toConfirm()}
            >
              {busy ? 'Counting…' : 'Continue'}
            </Button>
          </div>
        </section>
      ) : null}

      {step === 'confirm' && preview ? (
        <section className="pupzy-announcement-step" aria-labelledby="announcement-confirm-heading">
          <h3 id="announcement-confirm-heading">Confirm and send</h3>
          <div className="pupzy-card pupzy-announcement-confirm" data-testid="announcement-confirm">
            <p className="pupzy-announcement-confirm-count" data-testid="announcement-confirm-count">
              {formatCount(preview.count)}
            </p>
            <p className="pupzy-announcement-confirm-label">
              {preview.count === 1 ? 'user' : 'users'} will receive this announcement
            </p>
            <p className="pupzy-announcement-summary">{audienceSummary(form, preview)}</p>
            <ul className="pupzy-announcement-consequences">
              <li>Everyone counted gets it in the app, in their own language.</li>
              <li>Push goes only to users with notifications on.</li>
              <li>An announcement cannot be edited or unsent after it is sent.</li>
            </ul>
          </div>
          {stale ? (
            <p role="alert" className="pupzy-announcement-error" data-testid="announcement-stale">
              {stale.message}
            </p>
          ) : null}
          <div className="pupzy-announcement-actions">
            <Button type="button" variant="text" data-testid="announcement-back" onClick={() => setStep('preview')}>
              Back
            </Button>
            <Button
              type="button"
              variant="primary"
              data-testid="announcement-send"
              disabled={busy || preview.count === 0}
              onClick={() => void send()}
            >
              {busy ? 'Sending…' : `Send to ${usersLabel(preview.count)}`}
            </Button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
