import CpoHome from '../../../../design-system/screens/CpoHome';
import { useCpoHome } from '../hooks/useCpoHome';

export function CpoHomeController() {
  const { title, items } = useCpoHome();
  return <CpoHome title={title} items={items} />;
}
