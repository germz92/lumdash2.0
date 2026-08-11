/**
 * User settings catalog — single source of truth for configurable settings.
 * Add new sections/groups/items here as the settings page grows.
 *
 * Notification item keys match Notification.type where applicable, or
 * standalone keys for email-only alerts (e.g. reimbursement_approved).
 */

const ALL_ROLES = ['user', 'planner', 'admin', 'production_manager'];

const NOTIFICATION_SECTION = {
  id: 'notifications',
  title: 'Notifications',
  description: 'Choose which alerts you receive as toast popups and email.',
  groups: [
    {
      id: 'tasks',
      title: 'Tasks',
      items: [
        {
          key: 'task_assigned',
          label: 'Task assigned to you',
          description: 'When someone assigns you a task on an event.',
          roles: ALL_ROLES,
          defaults: { toast: true, email: false },
          channels: { toast: true, email: false }
        },
        {
          key: 'task_updated',
          label: 'Task updated',
          description: 'When a task assigned to you is updated.',
          roles: ALL_ROLES,
          defaults: { toast: true, email: false },
          channels: { toast: true, email: false }
        }
      ]
    },
    {
      id: 'events',
      title: 'Events & collaboration',
      items: [
        {
          key: 'event_shared',
          label: 'Added to an event',
          description: 'When you are added to an event as owner, lead, or collaborator.',
          roles: ALL_ROLES,
          defaults: { toast: true, email: true },
          channels: { toast: true, email: true }
        },
        {
          key: 'owner_request',
          label: 'Owner access request',
          description: 'When someone requests owner access to an event you own.',
          roles: ALL_ROLES,
          defaults: { toast: true, email: false },
          channels: { toast: true, email: false }
        },
        {
          key: 'owner_request_approved',
          label: 'Owner request approved',
          description: 'When your request for owner access is approved.',
          roles: ALL_ROLES,
          defaults: { toast: true, email: false },
          channels: { toast: true, email: false }
        },
        {
          key: 'owner_request_denied',
          label: 'Owner request denied',
          description: 'When your request for owner access is denied.',
          roles: ALL_ROLES,
          defaults: { toast: true, email: false },
          channels: { toast: true, email: false }
        }
      ]
    },
    {
      id: 'flights',
      title: 'Flights',
      items: [
        {
          key: 'flight_request',
          label: 'New flight request',
          description: 'When a new flight request is submitted (planners & admins).',
          roles: ['planner', 'admin'],
          defaults: { toast: true, email: false },
          channels: { toast: true, email: false }
        },
        {
          key: 'flight_booked',
          label: 'Flight booked',
          description: 'When your flight request has been booked.',
          roles: ALL_ROLES,
          defaults: { toast: true, email: false },
          channels: { toast: true, email: false }
        }
      ]
    },
    {
      id: 'reimbursements',
      title: 'Reimbursements',
      items: [
        {
          key: 'reimbursement_submitted',
          label: 'Reimbursement submitted',
          description: 'When a new reimbursement is submitted for your review.',
          roles: ALL_ROLES,
          defaults: { toast: true, email: true },
          channels: { toast: true, email: true }
        },
        {
          key: 'reimbursement_approved',
          label: 'Reimbursement approved',
          description: 'When your reimbursement request is approved.',
          roles: ALL_ROLES,
          defaults: { toast: false, email: true },
          channels: { toast: false, email: true }
        }
      ]
    },
    {
      id: 'crew',
      title: 'Crew',
      items: [
        {
          key: 'crew_availability_response',
          label: 'Crew availability response',
          description: 'When a crew member accepts or declines an availability request on your event.',
          roles: ALL_ROLES,
          defaults: { toast: true, email: true },
          channels: { toast: true, email: true }
        }
      ]
    },
    {
      id: 'post_production',
      title: 'Post production',
      items: [
        {
          key: 'post_production_assigned',
          label: 'Post production assignment',
          description: 'When you are assigned as editor or owner on a deliverable.',
          roles: ALL_ROLES,
          defaults: { toast: true, email: true },
          channels: { toast: true, email: true }
        },
        {
          key: 'post_production_status_changed',
          label: 'Post production status change',
          description: 'When status changes on an item you own.',
          roles: ALL_ROLES,
          defaults: { toast: true, email: true },
          channels: { toast: true, email: true }
        },
        {
          key: 'post_production_update',
          label: 'Post production updates',
          description: 'When someone posts an update or reply on an item you follow.',
          roles: ALL_ROLES,
          defaults: { toast: true, email: true },
          channels: { toast: true, email: true }
        }
      ]
    },
    {
      id: 'feedback',
      title: 'Feedback & bug reports',
      items: [
        {
          key: 'feedback_submitted',
          label: 'New feedback submitted',
          description: 'When someone submits a bug report or feature request (admins).',
          roles: ['admin'],
          defaults: { toast: true, email: false },
          channels: { toast: true, email: false }
        },
        {
          key: 'feedback_status_changed',
          label: 'Your feedback status changed',
          description: 'When a bug you reported or feature you requested is updated.',
          roles: ALL_ROLES,
          defaults: { toast: true, email: false },
          channels: { toast: true, email: false }
        }
      ]
    },
    {
      id: 'video_portal',
      title: 'Video portal',
      items: [
        {
          key: 'portal_comment',
          label: 'Client video comments',
          description: 'Batched alerts when a client leaves comments on a portal project. Admins, production managers, project creators, and version uploaders are notified. Rapid comments in one session are grouped into a single notification/email.',
          roles: ALL_ROLES,
          defaults: { toast: true, email: true },
          channels: { toast: true, email: true }
        },
        {
          key: 'portal_decision',
          label: 'Client approved a cut',
          description: 'When a client approves a cut on a portal project.',
          roles: ALL_ROLES,
          defaults: { toast: true, email: true },
          channels: { toast: true, email: true }
        },
        {
          key: 'portal_feedback_due',
          label: 'Feedback due reminders',
          description: 'When a portal project’s client feedback due date is approaching or past.',
          roles: ALL_ROLES,
          defaults: { toast: true, email: true },
          channels: { toast: true, email: true }
        },
        {
          key: 'portal_mention',
          label: 'Portal @mentions',
          description: 'When someone @mentions you on a video portal comment.',
          roles: ALL_ROLES,
          defaults: { toast: true, email: true },
          channels: { toast: true, email: true }
        }
      ]
    },
    {
      id: 'other',
      title: 'Other',
      items: [
        {
          key: 'general',
          label: 'General notifications',
          description: 'Other system notifications.',
          roles: ALL_ROLES,
          defaults: { toast: true, email: false },
          channels: { toast: true, email: false }
        }
      ]
    }
  ]
};

/** Placeholder sections for future settings (shown as coming soon in UI) */
const PLANNED_SECTIONS = [
  { id: 'appearance', title: 'Appearance', description: 'Theme and display preferences.' },
  { id: 'privacy', title: 'Privacy & security', description: 'Account visibility and security options.' }
];

const SETTINGS_SECTIONS = [NOTIFICATION_SECTION];

function normalizeRole(role) {
  const r = String(role || 'user').toLowerCase();
  return ALL_ROLES.includes(r) ? r : 'user';
}

function itemVisibleForRole(item, role) {
  return (item.roles || ALL_ROLES).includes(normalizeRole(role));
}

function getNotificationCatalogForRole(role) {
  const r = normalizeRole(role);
  return {
    ...NOTIFICATION_SECTION,
    groups: NOTIFICATION_SECTION.groups
      .map(group => ({
        ...group,
        items: group.items.filter(item => itemVisibleForRole(item, r))
      }))
      .filter(group => group.items.length > 0)
  };
}

function getAllNotificationItems(role) {
  const catalog = getNotificationCatalogForRole(role);
  return catalog.groups.flatMap(g => g.items);
}

function getDefaultNotificationPrefs(role) {
  const prefs = {};
  getAllNotificationItems(role).forEach(item => {
    prefs[item.key] = {
      toast: item.channels.toast ? item.defaults.toast !== false : false,
      email: item.channels.email ? item.defaults.email !== false : false
    };
  });
  return prefs;
}

function getSettingsCatalog(role) {
  return {
    sections: SETTINGS_SECTIONS.map(section => {
      if (section.id === 'notifications') {
        return getNotificationCatalogForRole(role);
      }
      return section;
    }),
    plannedSections: PLANNED_SECTIONS
  };
}

module.exports = {
  ALL_ROLES,
  SETTINGS_SECTIONS,
  PLANNED_SECTIONS,
  normalizeRole,
  getNotificationCatalogForRole,
  getAllNotificationItems,
  getDefaultNotificationPrefs,
  getSettingsCatalog
};
