'use client';

import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useState } from 'react';
import Image from 'next/image';
import {
  actionsDropdownItems,
  defaultSharePermissions,
  normalizeSharePermissions,
  sharePrivileges,
} from '@/constants';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  deleteFile,
  renameFile,
  updateFileUsers,
} from '@/lib/actions/file.actions';
import { usePathname } from 'next/navigation';
import {
  DetailsWithAccess,
  FileDetails,
  ShareInput,
} from '@/components/ActionsModalContent';
import { useToast } from '@/hooks/use-toast';

const normalizeAddress = (value: string) => value.trim().toLowerCase();

const sharesFrom = (file: FileDocument) =>
  file.shares?.length
    ? file.shares.map((share) => ({
        email: share.email,
        permissions: normalizeSharePermissions(share.permissions ?? []),
      }))
    : (file.users ?? []).map((email) => ({
        email,
        permissions: defaultSharePermissions,
      }));

// Details and download come with being able to open the file. Each other
// menu item is listed on a privilege. Share stays with the owner.
const allowedActions = (file: FileDocument, currentUserId: string) => {
  const owner =
    file.access === 'owner' ||
    (!file.access && file.accountId === currentUserId);
  const granted = new Set(file.permissions ?? []);
  const allowed = new Set(['details', 'download']);

  for (const privilege of sharePrivileges) {
    if (!('action' in privilege) || !privilege.action) continue;
    if (owner || granted.has(privilege.key)) allowed.add(privilege.action);
  }

  if (owner) allowed.add('share');

  return allowed;
};

const ActionDropdown = ({
  file,
  currentUserId,
}: {
  file: FileDocument;
  currentUserId: string;
}) => {
  const { toast } = useToast();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [action, setAction] = useState<ActionType | null>(null);
  const nameWithoutExtension = file.extension
    ? file.name.replace(new RegExp(`\\.${file.extension}$`, 'i'), '')
    : file.name;
  const [name, setName] = useState(nameWithoutExtension);
  const [isLoading, setIsLoading] = useState(false);
  const [recipients, setRecipients] = useState(sharesFrom(file));
  const [draft, setDraft] = useState('');
  const [draftPermissions, setDraftPermissions] = useState<SharePrivilege[]>(
    defaultSharePermissions,
  );

  const path = usePathname();
  const allowed = allowedActions(file, currentUserId);
  const actions = actionsDropdownItems.filter((item) => allowed.has(item.value));

  const closeAllModals = () => {
    setIsModalOpen(false);
    setIsDropdownOpen(false);
    setAction(null);
    setName(nameWithoutExtension);
    setDraft('');
  };

  const notify = (description: string, failed = false) => {
    toast({
      description: <p className="body-2 text-white">{description}</p>,
      className: failed ? 'error-toast' : 'success-toast',
    });
  };

  const handleAction = async () => {
    if (!action) return;
    // The menu already hides anything these privileges do not allow. This stops
    // a stale dialog from sending a rename, share, or delete the server would reject.
    if (!allowed.has(action.value)) return;

    setIsLoading(true);

    try {
      if (action.value === 'share') {
        const typed = draft
          .split(',')
          .map(normalizeAddress)
          .filter((email) => email.includes('@'));
        const ownerEmail = normalizeAddress(file.owner?.email ?? '');
        // The owner already has the file. The server drops this address, so
        // treating it as a new recipient showed a success toast for nothing.
        const fresh = typed.filter(
          (email) =>
            email !== ownerEmail &&
            !recipients.some((person) => person.email === email),
        );

        if (!typed.length) {
          notify('Enter an email address.', true);
          return;
        }

        if (typed.every((email) => email === ownerEmail)) {
          notify('You already own this file.', true);
          setDraft('');
          return;
        }

        if (!fresh.length) {
          notify('That address already has access.');
          setDraft('');
          return;
        }

        const saved = await updateFileUsers({
          fileId: file.$id,
          shares: [
            ...recipients,
            ...fresh.map((email) => ({
              email,
              permissions: normalizeSharePermissions(draftPermissions),
            })),
          ],
          path,
        });
        const savedShares: { email: string; permissions: SharePrivilege[] }[] =
          saved?.shares ?? [];
        const added = fresh.filter((email) =>
          savedShares.some((share) => share.email === email),
        );

        if (!saved?.$id || !added.length) {
          notify('You already own this file.', true);
          setDraft('');
          return;
        }

        const enabled = sharePrivileges
          .filter(
            (privilege) =>
              !('required' in privilege) &&
              draftPermissions.includes(privilege.key),
          )
          .map((privilege) => privilege.label);
        const summary = enabled.length ? enabled.join(', ') : 'View only';

        setRecipients(savedShares);
        setDraft('');
        setDraftPermissions(defaultSharePermissions);
        notify(
          added.length === 1
            ? `Shared with ${added[0]}. ${summary}.`
            : `Shared with ${added.length} people. ${summary}.`,
        );
        return;
      }

      const saved =
        action.value === 'rename'
          ? await renameFile({
              fileId: file.$id,
              name,
              extension: file.extension,
              path,
            })
          : await deleteFile({
              fileId: file.$id,
              bucketFileId: file.bucketFileId,
              path,
            });

      if (saved) closeAllModals();
    } catch {
      notify(
        action.value === 'share'
          ? 'Could not share this file. Try again.'
          : 'That action failed. Try again.',
        true,
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleRemoveUser = async (email: string) => {
    const previous = recipients;
    const next = previous.filter((person) => person.email !== email);

    setIsLoading(true);
    setRecipients(next);

    try {
      const saved = await updateFileUsers({
        fileId: file.$id,
        shares: next,
        path,
      });

      if (!saved?.$id) throw new Error('Could not update sharing.');

      setRecipients(saved.shares ?? next);
      notify(`Removed ${email}.`);
    } catch {
      setRecipients(previous);
      notify(`Could not remove ${email}. Try again.`, true);
    } finally {
      setIsLoading(false);
    }
  };

  const handlePermissionsChange = async (
    email: string,
    permissions: SharePrivilege[],
  ) => {
    const previous = recipients;
    const current = previous.find((person) => person.email === email);
    const nextPermissions = normalizeSharePermissions(permissions);

    if (!current) return;
    if (
      current.permissions.length === nextPermissions.length &&
      current.permissions.every((key) => nextPermissions.includes(key))
    ) {
      return;
    }

    const next = previous.map((person) =>
      person.email === email ? { ...person, permissions: nextPermissions } : person,
    );
    const changed = sharePrivileges.find(
      (privilege) =>
        current.permissions.includes(privilege.key) !==
        nextPermissions.includes(privilege.key),
    );

    setIsLoading(true);
    setRecipients(next);

    try {
      const saved = await updateFileUsers({
        fileId: file.$id,
        shares: next,
        path,
      });

      if (!saved?.$id) throw new Error('Could not update access.');

      setRecipients(saved.shares ?? next);
      notify(
        changed
          ? `${changed.label} is ${
              nextPermissions.includes(changed.key) ? 'on' : 'off'
            } for ${email}.`
          : `Updated access for ${email}.`,
      );
    } catch {
      setRecipients(previous);
      notify(`Could not update access for ${email}. Try again.`, true);
    } finally {
      setIsLoading(false);
    }
  };

  const renderDialogContent = () => {
    if (!action) return null;

    const { value, label } = action;

    if (value === 'details' && file.access === 'owner' && file.shares.length > 0) {
      return (
        <DialogContent className="share-dialog button w-max max-w-[calc(100vw-1.5rem)] border-0 bg-transparent p-0 shadow-none">
          <DetailsWithAccess file={file} />
        </DialogContent>
      );
    }

    if (value === 'share') {
      return (
        <DialogContent className="share-dialog button w-max max-w-[calc(100vw-1.5rem)] border-0 bg-transparent p-0 shadow-none">
          <ShareInput
            file={file}
            recipients={recipients}
            draft={draft}
            draftPermissions={draftPermissions}
            onDraftChange={setDraft}
            onDraftPermissionsChange={setDraftPermissions}
            onPermissionsChange={handlePermissionsChange}
            onRemove={handleRemoveUser}
            onCancel={closeAllModals}
            onShare={handleAction}
            busy={isLoading}
          />
        </DialogContent>
      );
    }

    return (
      <DialogContent className="shad-dialog button">
        <DialogHeader className="flex flex-col gap-3">
          <DialogTitle className="text-center text-light-100">
            {label}
          </DialogTitle>
          {value === 'rename' && (
            <Input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          )}
          {value === 'details' && <FileDetails file={file} />}
          {value === 'delete' && (
            <p className="delete-confirmation">
              Are you sure you want to delete{` `}
              <span className="delete-file-name">{file.name}</span>?
            </p>
          )}
        </DialogHeader>
        {['rename', 'delete'].includes(value) && (
          <DialogFooter className="flex flex-col gap-3 md:flex-row">
            <Button onClick={closeAllModals} className="modal-cancel-button">
              Cancel
            </Button>
            <Button
              onClick={handleAction}
              className="modal-submit-button"
              disabled={isLoading}
            >
              <p className="capitalize">{value}</p>
              {isLoading && (
                <Image
                  src="/assets/icons/loader.svg"
                  alt="loader"
                  width={24}
                  height={24}
                  className="animate-spin"
                />
              )}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    );
  };

  return (
    <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
      <DropdownMenu open={isDropdownOpen} onOpenChange={setIsDropdownOpen}>
        <DropdownMenuTrigger className="shad-no-focus">
          <Image
            src="/assets/icons/dots.svg"
            alt="dots"
            width={34}
            height={34}
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuLabel className="max-w-[200px] truncate">
            {file.name}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {actions.map((actionItem) => (
            <DropdownMenuItem
              key={actionItem.value}
              className="shad-dropdown-item"
              onClick={() => {
                setAction(actionItem);
                setRecipients(sharesFrom(file));
                setDraft('');
                setDraftPermissions(defaultSharePermissions);

                if (
                  ['rename', 'share', 'delete', 'details'].includes(
                    actionItem.value,
                  )
                ) {
                  setIsModalOpen(true);
                }
              }}
            >
              {actionItem.value === 'download' ? (
                <a
                  href={file.downloadUrl}
                  className="flex items-center gap-2"
                >
                  <Image
                    src={actionItem.icon}
                    alt={actionItem.label}
                    width={30}
                    height={30}
                  />
                  {actionItem.label}
                </a>
              ) : (
                <div className="flex items-center gap-2">
                  <Image
                    src={actionItem.icon}
                    alt={actionItem.label}
                    width={30}
                    height={30}
                  />
                  {actionItem.label}
                </div>
              )}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {renderDialogContent()}
    </Dialog>
  );
};
export default ActionDropdown;
