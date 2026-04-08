'use client';

import * as React from 'react';
import { ChevronDown, ChevronUp, ChevronsUpDown } from 'lucide-react';
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { TableSkeleton } from '@/components/skeletons/TableSkeleton';
import { EmptyState } from '@/components/EmptyState';
import { cn } from '@/lib/utils';

export type DataTableColumn<T> = {
  key: string;
  header: React.ReactNode;
  cell: (row: T, index: number) => React.ReactNode;
  align?: 'left' | 'right' | 'center';
  width?: string | number;
  sortable?: boolean;
  sortAccessor?: (row: T) => string | number | Date | null | undefined;
  className?: string;
  headerClassName?: string;
};

export interface DataTableEmptyState {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void };
}

export interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  data: T[];
  loading?: boolean;
  emptyState?: DataTableEmptyState;
  onRowClick?: (row: T, index: number) => void;
  rowKey: (row: T, index: number) => string;
  density?: 'compact' | 'comfortable';
  zebra?: boolean;
  className?: string;
  caption?: string;
  footer?: React.ReactNode;
}

type SortState = { column: string; direction: 'asc' | 'desc' } | null;

const ALIGN: Record<NonNullable<DataTableColumn<unknown>['align']>, string> = {
  left: 'text-left',
  right: 'text-right',
  center: 'text-center',
};

export function DataTable<T>({
  columns,
  data,
  loading,
  emptyState,
  onRowClick,
  rowKey,
  density = 'comfortable',
  zebra = false,
  className,
  caption,
  footer,
}: DataTableProps<T>) {
  const [sort, setSort] = React.useState<SortState>(null);

  const sortedData = React.useMemo(() => {
    if (!sort) return data;
    const col = columns.find(c => c.key === sort.column);
    if (!col?.sortAccessor) return data;
    const accessor = col.sortAccessor;
    const dir = sort.direction === 'asc' ? 1 : -1;
    return [...data].sort((a, b) => {
      const va = accessor(a);
      const vb = accessor(b);
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
      return 0;
    });
  }, [data, sort, columns]);

  const handleSort = (col: DataTableColumn<T>) => {
    if (!col.sortable) return;
    setSort(prev => {
      if (!prev || prev.column !== col.key) return { column: col.key, direction: 'asc' };
      if (prev.direction === 'asc') return { column: col.key, direction: 'desc' };
      return null;
    });
  };

  if (loading) {
    return <TableSkeleton rows={5} cols={columns.length} />;
  }

  if (!data.length && emptyState) {
    return (
      <EmptyState
        icon={emptyState.icon ?? null}
        title={emptyState.title}
        description={emptyState.description ?? ''}
        action={emptyState.action}
      />
    );
  }

  const cellPad = density === 'compact' ? 'py-2' : 'py-3';

  return (
    <Table className={className}>
      {caption && <TableCaption>{caption}</TableCaption>}
      <TableHeader>
        <TableRow>
          {columns.map(col => {
            const isSorted = sort?.column === col.key;
            const Icon = !isSorted ? ChevronsUpDown : sort.direction === 'asc' ? ChevronUp : ChevronDown;
            return (
              <TableHead
                key={col.key}
                style={col.width ? { width: col.width } : undefined}
                className={cn(
                  col.align && ALIGN[col.align],
                  col.sortable && 'cursor-pointer select-none',
                  col.headerClassName,
                )}
                onClick={col.sortable ? () => handleSort(col) : undefined}
                aria-sort={
                  isSorted ? (sort.direction === 'asc' ? 'ascending' : 'descending') : undefined
                }
              >
                <span className="inline-flex items-center gap-1">
                  {col.header}
                  {col.sortable && <Icon className="w-3 h-3 opacity-60" />}
                </span>
              </TableHead>
            );
          })}
        </TableRow>
      </TableHeader>
      <TableBody>
        {sortedData.map((row, rIdx) => (
          <TableRow
            key={rowKey(row, rIdx)}
            data-zebra={zebra ? 'on' : undefined}
            onClick={onRowClick ? () => onRowClick(row, rIdx) : undefined}
            onKeyDown={
              onRowClick
                ? e => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onRowClick(row, rIdx);
                    }
                  }
                : undefined
            }
            role={onRowClick ? 'button' : undefined}
            tabIndex={onRowClick ? 0 : undefined}
            className={cn(
              onRowClick && 'cursor-pointer',
              zebra && 'data-[zebra=on]:odd:bg-[var(--t-bg)]/40',
            )}
          >
            {columns.map(col => (
              <TableCell
                key={col.key}
                className={cn(cellPad, col.align && ALIGN[col.align], col.className)}
              >
                {col.cell(row, rIdx)}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
      {footer && (
        <tfoot data-slot="table-footer">
          <tr>
            <td colSpan={columns.length} className="px-3 py-3 border-t border-[var(--t-border)]">
              {footer}
            </td>
          </tr>
        </tfoot>
      )}
    </Table>
  );
}
