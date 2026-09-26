import React from 'react';
import Sort from '@/components/Sort';
import { getFiles, getTotalSpaceUsed } from '@/lib/actions/file.actions';
import { getCurrentUser } from '@/lib/actions/user.actions';
import Card from '@/components/Card';
import { convertFileSize, getFileTypesParams } from '@/lib/utils';
import { redirect } from 'next/navigation';

const Page = async ({ searchParams, params }: SearchParamProps) => {
  const type = ((await params)?.type as string) || '';
  const searchText = ((await searchParams)?.query as string) || '';
  const sort = ((await searchParams)?.sort as string) || '';

  const currentUser = await getCurrentUser();

  if (!currentUser) redirect('/sign-in');

  const types = getFileTypesParams(type) as FileType[];

  // Same pair of reads as the dashboard, scoped to this type. Running them
  // together keeps the heading size from waiting on the file list.
  const [files, totalSize] = await Promise.all([
    getFiles({ types, searchText, sort }),
    getTotalSpaceUsed(),
  ]);

  const size = types
    .map((type) => {
      return totalSize[type].size;
    })
    .reduce((a, b) => a + b, 0);

  return (
    <div className="page-container">
      <section className="w-full">
        <h1 className="h1 capitalize">{type}</h1>

        <div className="total-size-section">
          <p className="body-1">
            Total: <span className="h5">{convertFileSize(size)}</span>
          </p>

          <div className="sort-container">
            <p className="body-1 hidden text-light-200 sm:block">Sort by:</p>

            <Sort />
          </div>
        </div>
      </section>

      {/* Render the files */}
      {files.total > 0 ? (
        <section className="file-list">
          {files.documents.map((file: FileDocument) => (
            <Card
              key={file.$id}
              file={file}
              currentUserId={currentUser.$id}
            />
          ))}
        </section>
      ) : (
        <p className="empty-list">No files uploaded</p>
      )}
    </div>
  );
};

export default Page;
