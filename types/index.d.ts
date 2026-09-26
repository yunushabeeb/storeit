/* eslint-disable no-unused-vars */

declare type FileType = 'document' | 'image' | 'video' | 'audio' | 'other';

declare interface ActionType {
  label: string;
  icon: string;
  value: string;
}

declare interface SearchParamProps {
  params?: Promise<SegmentParams>;
  searchParams?: Promise<{ [key: string]: string | string[] | undefined }>;
}

declare interface UploadFileProps {
  file: File;
  ownerId: string;
  accountId: string;
  path: string;
}
declare interface GetFilesProps {
  types: FileType[];
  searchText?: string;
  sort?: string;
  limit?: number;
}
declare interface RenameFileProps {
  fileId: string;
  name: string;
  extension: string;
  path: string;
}
declare type SharePrivilege = 'view' | 'rename' | 'delete';

declare interface UpdateFileUsersProps {
  fileId: string;
  shares: { email: string; permissions: SharePrivilege[] }[];
  path: string;
}
declare interface DeleteFileProps {
  fileId: string;
  bucketFileId: string;
  path: string;
}

declare interface FileUploaderProps {
  ownerId: string;
  accountId: string;
  className?: string;
}

declare interface MobileNavigationProps {
  ownerId: string;
  accountId: string;
  fullName: string;
  avatar: string;
  email: string;
}
declare interface SidebarProps {
  fullName: string;
  avatar: string;
  email: string;
}

declare interface ThumbnailProps {
  type: string;
  extension: string;
  url: string;
  className?: string;
  imageClassName?: string;
}

declare interface ShareInputProps {
  file: FileDocument;
  onInputChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onRemove: (email: string) => void;
}

declare interface FileUploaderProps {
  ownerId: string;
  accountId: string;
  className?: string;
}

declare interface MobileNavProps {
  $id: string;
  accountId: string;
  fullName: string;
  avatar: string;
  email: string;
}

declare interface SidebarProps {
  fullName: string;
  avatar: string;
  email: string;
}

declare interface HeaderProps {
  userId: string;
  accountId: string;
}

declare interface ThumbnailProps {
  type: string;
  extension: string;
  url?: string;
  imageClassName?: string;
  className?: string;
}

declare interface FileUploaderProps {
  ownerId: string;
  accountId: string;
  className?: string;
}

// The shape every list and card already renders. Actions map a SQL row into
// this instead of teaching the components about column names.
declare interface FileDocument {
  $id: string;
  $createdAt: string;
  $updatedAt: string;
  name: string;
  url: string;
  downloadUrl: string;
  extension: string;
  size: number;
  type: FileType | string;
  users: string[];
  shares: { email: string; permissions: SharePrivilege[] }[];
  permissions: SharePrivilege[];
  access: 'owner' | 'shared';
  bucketFileId: string;
  accountId: string;
  owner: {
    $id: string;
    accountId: string;
    fullName: string;
    email: string;
    avatar: string;
  };
}

declare type FormType = 'sign-in' | 'sign-up';

declare interface ActionsModalContentProps {
  file: FileDocument;
  recipients: { email: string; permissions: SharePrivilege[] }[];
  draft: string;
  draftPermissions: SharePrivilege[];
  onDraftChange: (value: string) => void;
  onDraftPermissionsChange: (permissions: SharePrivilege[]) => void;
  onPermissionsChange: (email: string, permissions: SharePrivilege[]) => void;
  onRemove: (email: string) => void;
  onCancel: () => void;
  onShare: () => void;
  busy?: boolean;
}
