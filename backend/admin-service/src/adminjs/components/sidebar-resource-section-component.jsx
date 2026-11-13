import React, { useCallback, useState } from 'react';
import { Navigation } from '@adminjs/design-system';
import { useTranslation } from 'adminjs';
import { useLocation, useNavigate } from 'react-router';

import { adminRootPath } from './list-return.js';
import { buildNavigation } from '../navigation.js';

const STORAGE_KEY = 'pupzy:nav-open';

function readOpenState() {
  try {
    return JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}') ?? {};
  } catch {
    return {};
  }
}

function writeOpenState(value) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Without storage the groups simply open in their default state on each load.
  }
}

/**
 * The sidebar: the Inbox first, then resources grouped by task (see
 * `navigation.js`). A group is open unless it is collapsed by default
 * ("Records") or the moderator closed it; the choice is remembered per browser.
 */
export default function SidebarResourceSection({ resources }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { translateLabel } = useTranslation();
  const [openState, setOpenState] = useState(readOpenState);
  const rootPath = adminRootPath();

  const toggle = useCallback((name, isOpen) => {
    setOpenState((current) => {
      const next = { ...current, [name]: !isOpen };
      writeOpenState(next);
      return next;
    });
  }, []);

  const go = (href) => (event) => {
    event.preventDefault();
    navigate(href);
  };
  const selected = (href) => location.pathname === href || location.pathname.startsWith(`${href}/`);
  const leaf = (resource) => ({
    href: resource.href,
    label: translateLabel(resource.name, resource.id),
    id: resource.id,
    isSelected: selected(resource.href),
    onClick: go(resource.href),
  });

  const inbox = {
    href: rootPath,
    label: 'Inbox',
    icon: 'Inbox',
    id: 'inbox',
    isSelected: location.pathname === rootPath || location.pathname === `${rootPath}/`,
    onClick: go(rootPath),
  };

  const groups = buildNavigation(resources).map((group) => {
    if (group.topLevel) return { ...leaf(group.items[0]), icon: group.icon };
    const containsCurrentPage = group.items.some((item) => selected(item.href));
    const isOpen = containsCurrentPage || (openState[group.name] ?? !group.collapsedByDefault);
    return {
      label: group.name,
      icon: group.icon,
      isOpen,
      elements: group.items.map(leaf),
      onClick: () => toggle(group.name, isOpen),
    };
  });

  return <Navigation label={translateLabel('navigation')} elements={[inbox, ...groups]} />;
}
