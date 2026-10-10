"use client";
/*
 * Documentation:
 * Table — https://app.subframe.com/de62b029ca8b/library?component=Table_142dfde7-d0cc-48a1-a04c-a08ab2252633
 */

import React from "react";
import * as SubframeCore from "@subframe/core";
import * as SubframeUtils from "../../utils";

export interface RowProps extends React.HTMLAttributes<HTMLTableRowElement> {
  children?: React.ReactNode;
  clickable?: boolean;
  className?: string;
}

const Row = React.forwardRef<HTMLTableRowElement, RowProps>(function Row(
  { children, clickable = false, className, ...otherProps }: RowProps,
  ref
) {
  return (
    <tr
      className={SubframeUtils.twClassNames(
        "group/5d119f8d border-t border-solid border-neutral-border [&>td:first-child>div]:pl-6 [&>td:last-child>div]:pr-6",
        {
          "hover:Rounded-md hover:border-t hover:border-x-0 hover:border-b-0 hover:border-solid hover:border-default-background hover:bg-neutral-50 hover:overflow-hidden":
            clickable,
        },
        className
      )}
      ref={ref}
      {...otherProps}
    >
      {children}
    </tr>
  );
});

export interface CellProps
  extends React.TdHTMLAttributes<HTMLTableDataCellElement> {
  children?: React.ReactNode;
  variant?: "left-aligned" | "right-aligned";
  className?: string;
}

const Cell = React.forwardRef<HTMLTableDataCellElement, CellProps>(
  function Cell(
    { children, variant = "left-aligned", className, ...otherProps }: CellProps,
    ref
  ) {
    return (
      <td
        className={SubframeUtils.twClassNames("h-16", className)}
        ref={ref}
        {...otherProps}
      >
        <div
          className={SubframeUtils.twClassNames(
            "group/291d4418 flex h-full w-full items-center gap-1 px-3",
            { "justify-end": variant === "right-aligned" }
          )}
        >
          {children}
        </div>
      </td>
    );
  }
);

export interface HeaderRowProps
  extends React.HTMLAttributes<HTMLTableRowElement> {
  children?: React.ReactNode;
  className?: string;
}

const HeaderRow = React.forwardRef<HTMLTableRowElement, HeaderRowProps>(
  function HeaderRow(
    { children, className, ...otherProps }: HeaderRowProps,
    ref
  ) {
    return (
      <tr className={className} ref={ref} {...otherProps}>
        {children}
      </tr>
    );
  }
);

export interface HeaderCellProps
  extends React.ThHTMLAttributes<HTMLTableHeaderCellElement> {
  children?: React.ReactNode;
  icon?: React.ReactNode;
  variant?: "left-aligned" | "right-aligned";
  className?: string;
}

const HeaderCell = React.forwardRef<
  HTMLTableHeaderCellElement,
  HeaderCellProps
>(function HeaderCell(
  {
    children,
    icon = null,
    variant = "left-aligned",
    className,
    ...otherProps
  }: HeaderCellProps,
  ref
) {
  return (
    <th
      className={SubframeUtils.twClassNames("h-8", className)}
      ref={ref}
      {...otherProps}
    >
      <div
        className={SubframeUtils.twClassNames(
          "group/a3a9d884 flex h-full w-full items-center gap-1 px-3 text-left",
          { "justify-end text-right": variant === "right-aligned" }
        )}
      >
        {children ? (
          <span className="whitespace-nowrap text-overline-xs-mono font-overline-xs-mono text-neutral-400 uppercase">
            {children}
          </span>
        ) : null}
        {icon ? (
          <SubframeCore.IconWrapper className="text-caption font-caption text-neutral-400">
            {icon}
          </SubframeCore.IconWrapper>
        ) : null}
      </div>
    </th>
  );
});

export interface TableRootProps
  extends React.TableHTMLAttributes<HTMLTableElement> {
  header?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}

const TableRoot = React.forwardRef<HTMLTableElement, TableRootProps>(
  function TableRoot(
    { header, children, className, ...otherProps }: TableRootProps,
    ref
  ) {
    return (
      <table
        className={SubframeUtils.twClassNames("h-fit w-full", className)}
        ref={ref}
        {...otherProps}
      >
        <thead>{header}</thead>
        <tbody className="border-b border-solid border-neutral-border">
          {children}
        </tbody>
      </table>
    );
  }
);

export const Table = Object.assign(TableRoot, {
  Row,
  Cell,
  HeaderRow,
  HeaderCell,
});
