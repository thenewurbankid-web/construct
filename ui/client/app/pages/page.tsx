import { PagesScreenController } from '@/features/line-pages/controllers/PagesScreenController';

// The Pages screen: a Line project gets the Line Pages screen (pick a feature, its pages, change a prop); any other
// project keeps the Pages editor exactly as before.
export default function Page() {
  return <PagesScreenController />;
}
