import { LineImportController } from '@/features/line-import/controllers/LineImportController';

// The Import screen: bring one folder of an existing app into Line; only that folder is ever written.
export default function Page() {
  return <LineImportController />;
}
