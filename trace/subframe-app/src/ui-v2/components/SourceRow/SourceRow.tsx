"use client";
/*
 * Documentation:
 * Badge — https://app.subframe.com/de62b029ca8b/library?component=Badge_97bdb082-1124-4dd7-a335-b14b822d0157
 * Button — https://app.subframe.com/de62b029ca8b/library?component=Button_3b777358-b86b-40af-9327-891efc6826fe
 * SourceRow — https://app.subframe.com/de62b029ca8b/library?component=SourceRow_5a4d5b03-d08b-4e72-8096-3d953725d64d
 * Switch — https://app.subframe.com/de62b029ca8b/library?component=Switch_7a464794-9ea9-4040-b1de-5bfb2ce599d9
 */

import React from "react";
import * as SubframeUtils from "../../utils";
import { Badge } from "../Badge";
import { Button } from "../Button";
import { Switch } from "../Switch";

export interface SourceRowRootProps
  extends React.HTMLAttributes<HTMLDivElement> {
  logo?: string;
  name?: React.ReactNode;
  description?: React.ReactNode;
  type1?: React.ReactNode;
  type2?: React.ReactNode;
  type3?: React.ReactNode;
  hideType2?: boolean;
  hideType3?: boolean;
  meta?: React.ReactNode;
  trailing?: "toggle" | "add" | "locked";
  actionLabel?: React.ReactNode;
  className?: string;
}

const SourceRowRoot = React.forwardRef<HTMLDivElement, SourceRowRootProps>(
  function SourceRowRoot(
    {
      logo,
      name,
      description,
      type1,
      type2,
      type3,
      hideType2 = false,
      hideType3 = false,
      meta,
      trailing = "toggle",
      actionLabel,
      className,
      ...otherProps
    }: SourceRowRootProps,
    ref
  ) {
    return (
      <div
        className={SubframeUtils.twClassNames(
          "group/5a4d5b03 flex w-full items-center gap-4 border-b border-solid border-neutral-200 px-2 py-4 group/sourcerow",
          className
        )}
        ref={ref}
        {...otherProps}
      >
        <div className="flex h-9 w-9 flex-none items-center justify-center overflow-hidden rounded-rounded-xs border border-solid border-neutral-200 bg-default-background">
          {logo ? (
            <img
              className="grow shrink-0 basis-0 self-stretch object-cover"
              src={logo}
            />
          ) : null}
        </div>
        <div className="flex min-w-[0px] grow shrink-0 basis-0 flex-col items-start gap-1">
          {name ? (
            <span className="text-subtitle-1 font-subtitle-1 text-neutral-900">
              {name}
            </span>
          ) : null}
          {description ? (
            <span className="text-body-2 font-body-2 text-neutral-600">
              {description}
            </span>
          ) : null}
          <div className="flex items-center gap-3">
            {type1 ? (
              <span className="text-caption font-caption text-accent-vivid-indigo">
                {type1}
              </span>
            ) : null}
            {type2 ? (
              <span
                className={SubframeUtils.twClassNames(
                  "text-caption font-caption text-accent-vivid-indigo",
                  { hidden: hideType2 }
                )}
              >
                {type2}
              </span>
            ) : null}
            {type3 ? (
              <span
                className={SubframeUtils.twClassNames(
                  "text-caption font-caption text-accent-vivid-indigo",
                  { hidden: hideType3 }
                )}
              >
                {type3}
              </span>
            ) : null}
            {meta ? (
              <span className="text-caption font-caption text-neutral-500">
                {meta}
              </span>
            ) : null}
          </div>
        </div>
        <div className="flex items-center">
          <Switch
            className={SubframeUtils.twClassNames({
              hidden: trailing === "locked" || trailing === "add",
            })}
            checked={true}
          />
          <Button
            className={SubframeUtils.twClassNames("hidden", {
              flex: trailing === "add",
            })}
            variant="brand-subtle"
            size="small"
            slot={<Badge>Badge</Badge>}
          >
            {actionLabel}
          </Button>
          <div
            className={SubframeUtils.twClassNames(
              "hidden h-8 items-center rounded-rounded-xs bg-neutral-100 px-4",
              { flex: trailing === "locked" }
            )}
          >
            {actionLabel ? (
              <span className="text-body-2 font-body-2 text-neutral-500">
                {actionLabel}
              </span>
            ) : null}
          </div>
        </div>
      </div>
    );
  }
);

export const SourceRow = SourceRowRoot;
