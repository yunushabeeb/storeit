// Sidebar routes. The url segment is what getFileTypesParams switches on.
export const navItems = [
  {
    name: 'Dashboard',
    icon: '/assets/icons/dashboard.svg',
    url: '/',
  },
  {
    name: 'Documents',
    icon: '/assets/icons/documents.svg',
    url: '/documents',
  },
  {
    name: 'Images',
    icon: '/assets/icons/images.svg',
    url: '/images',
  },
  {
    name: 'Media',
    icon: '/assets/icons/video.svg',
    url: '/media',
  },
  {
    name: 'Others',
    icon: '/assets/icons/others.svg',
    url: '/others',
  },
];

export const actionsDropdownItems = [
  {
    label: 'Rename',
    icon: '/assets/icons/edit.svg',
    value: 'rename',
  },
  {
    label: 'Details',
    icon: '/assets/icons/info.svg',
    value: 'details',
  },
  {
    label: 'Share',
    icon: '/assets/icons/share.svg',
    value: 'share',
  },
  {
    label: 'Download',
    icon: '/assets/icons/download.svg',
    value: 'download',
  },
  {
    label: 'Delete',
    icon: '/assets/icons/delete.svg',
    value: 'delete',
  },
];

// Each entry is one switch in the share dialog. Add a privilege here when a
// new recipient action exists. view stays on because sharing is itself access
// to open the file. action is the menu item that privilege unlocks.
export const sharePrivileges = [
  {
    key: 'view',
    label: 'View',
    description: 'Open and download. Always included.',
    phrase: 'open and download it',
    required: true,
  },
  {
    key: 'rename',
    label: 'Rename',
    description: 'Change the file name',
    phrase: 'rename it',
    action: 'rename',
  },
  {
    key: 'delete',
    label: 'Delete',
    description: 'Remove the file',
    phrase: 'delete it',
    action: 'delete',
  },
] as const;

export type SharePrivilege = (typeof sharePrivileges)[number]['key'];

export const defaultSharePermissions: SharePrivilege[] = ['view'];

export const isSharePrivilege = (value: unknown): value is SharePrivilege =>
  sharePrivileges.some((privilege) => privilege.key === value);

// Unknown keys are dropped. view is always present so a share cannot exist
// without the ability to open the file.
export const normalizeSharePermissions = (values: readonly string[]) => {
  const selected = new Set(values);

  return sharePrivileges
    .map((privilege) => privilege.key)
    .filter((key) => key === 'view' || selected.has(key));
};

export const shareAccessLine = (values: readonly string[]) => {
  const phrases = sharePrivileges
    .filter((privilege) => values.includes(privilege.key))
    .map((privilege) => privilege.phrase);

  if (phrases.length <= 1) return `You can ${phrases[0] ?? 'open and download it'}.`;

  const last = phrases[phrases.length - 1];

  return `You can ${phrases.slice(0, -1).join(', ')}, and ${last}.`;
};

export const sortTypes = [
  {
    label: 'Date created (newest)',
    value: '$createdAt-desc',
  },
  {
    label: 'Created Date (oldest)',
    value: '$createdAt-asc',
  },
  {
    label: 'Name (A-Z)',
    value: 'name-asc',
  },
  {
    label: 'Name (Z-A)',
    value: 'name-desc',
  },
  {
    label: 'Size (Highest)',
    value: 'size-desc',
  },
  {
    label: 'Size (Lowest)',
    value: 'size-asc',
  },
];

export const avatarPlaceholderUrl =
  'https://img.freepik.com/free-psd/3d-illustration-person-with-sunglasses_23-2149436188.jpg';

export const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
