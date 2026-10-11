'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useGetOpportunitiesQuery } from '../api';
import { maxToast } from '../MaxToast';
import { analyticsService } from '../analytics';

export function buildOpportunityUrlParams(selectedCategory: string | null, activeTab: string) {
  const params = new URLSearchParams();
  if (selectedCategory) params.set('category', selectedCategory);
  if (activeTab !== 'all') params.set('tab', activeTab);
  return params;
}

export default function OpportunityClient({ items }: { items: string[] }) {
  const [activeTab, setActiveTab] = useState('all');
  const router = useRouter();
  const searchParams = useSearchParams();
  const category = searchParams.get('category');
  const { data, isLoading } = useGetOpportunitiesQuery(category);
  const sorted = useMemo(() => [...items].sort(), [items]);
  const handleTabChange = useCallback((tab: string) => {
    setActiveTab(tab);
    router.push(`/opportunity?${buildOpportunityUrlParams(category, tab)}`);
    analyticsService.trackEvent('tab', tab);
  }, [router, category]);
  useEffect(() => {
    const saved = localStorage.getItem('opportunity-tab');
    if (saved) setActiveTab(saved);
  }, []);
  const save = async () => {
    const res = await fetch('/api/opportunity', { method: 'POST' });
    if (!res.ok) maxToast.error('Could not save');
  };
  switch (activeTab) {
    case 'all':
      break;
    default:
      break;
  }
  const title = activeTab === 'all' ? 'All' : 'Filtered';
  return (
    <div onClick={() => handleTabChange('all')}>
      {isLoading && <span>Loading...</span>}
      {data ? <ul>{sorted.length}</ul> : <p>{title}</p>}
      <button onClick={save}>Save</button>
    </div>
  );
}
