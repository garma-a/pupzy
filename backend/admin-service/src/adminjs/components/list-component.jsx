import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ApiClient, RecordsTable, useSelectedRecords } from 'adminjs';
import { Pagination } from '@adminjs/design-system';
import { useLocation, useNavigate } from 'react-router';
const api = new ApiClient();
/** Stock table and selection behavior, with explicit loading, empty and retry states. */
export default function List({ resource, setTag }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const generation = useRef(0);
  const load = useCallback(async () => {
    const request = ++generation.current;
    setLoading(true);
    setError(false);
    try {
      const response = await api.resourceAction({
        resourceId: resource.id,
        actionName: 'list',
        params: new URLSearchParams(location.search),
      });
      if (request !== generation.current) return;
      if (response.data.redirectUrl) {
        navigate(response.data.redirectUrl);
        return;
      }
      setData(response.data);
      setTag?.(String(response.data.meta.total));
    } catch {
      if (request === generation.current) setError(true);
    } finally {
      if (request === generation.current) setLoading(false);
    }
  }, [resource.id, location.search, location.state]);
  useEffect(() => {
    setData(null);
    void load();
    return () => {
      generation.current += 1;
    };
  }, [load]);
  const selection = useSelectedRecords(data?.records ?? []);
  useEffect(() => selection.setSelectedRecords([]), [resource.id, location.search]);
  const page = (n) => {
    const query = new URLSearchParams(location.search);
    query.set('page', String(n));
    navigate({ pathname: location.pathname, search: query.toString() });
  };
  return (
    <div data-css={`${resource.id}-list-table-wrapper`}>
      {error ? (
        <div className="pupzy-list-state" role="alert">
          Records could not be loaded.{' '}
          <button type="button" onClick={() => void load()}>
            Retry
          </button>
        </div>
      ) : loading && !data ? (
        <div className="pupzy-list-state" role="status" aria-label="Loading records">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="pupzy-list-skeleton" />
          ))}
        </div>
      ) : !data?.records?.length ? (
        <div className="pupzy-list-state" role="status">
          No records match these filters.
        </div>
      ) : (
        <>
          <RecordsTable
            resource={resource}
            records={data.records}
            isLoading={loading}
            actionPerformed={load}
            sortBy={data.meta.sortBy}
            direction={data.meta.direction}
            selectedRecords={selection.selectedRecords}
            onSelect={selection.handleSelect}
            onSelectAll={selection.handleSelectAll}
          />
          <div style={{ padding: 24, textAlign: 'center' }}>
            <Pagination {...data.meta} onChange={page} />
          </div>
        </>
      )}
    </div>
  );
}
