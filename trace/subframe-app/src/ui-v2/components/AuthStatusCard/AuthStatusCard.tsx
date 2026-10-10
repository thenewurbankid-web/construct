"use client";
/*
 * Documentation:
 * AuthStatusCard — https://app.subframe.com/de62b029ca8b/library?component=AuthStatusCard_133bf4f1-00c4-4f4e-8f17-48939d921eab
 */

import React from "react";
import * as SubframeUtils from "../../utils";

export interface AuthStatusCardRootProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  title?: React.ReactNode;
  meta?: React.ReactNode;
  description?: React.ReactNode;
  showDot?: boolean;
  hideMeta?: boolean;
  hideDescription?: boolean;
  className?: string;
}

const AuthStatusCardRoot = React.forwardRef<
  HTMLDivElement,
  AuthStatusCardRootProps
>(function AuthStatusCardRoot(
  {
    title,
    meta,
    description,
    showDot = false,
    hideMeta = false,
    hideDescription = false,
    className,
    ...otherProps
  }: AuthStatusCardRootProps,
  ref
) {
  return (
    <div
      className={SubframeUtils.twClassNames(
        "group/133bf4f1 flex w-full flex-col items-start gap-2 rounded-rounded-md border border-solid border-neutral-200 bg-default-background px-5 py-4",
        className
      )}
      ref={ref}
      {...otherProps}
    >
      <div className="flex w-full items-center gap-2">
        <div
          className={SubframeUtils.twClassNames(
            "hidden h-2 w-2 flex-none items-start rounded-full bg-accent-vivid-indigo",
            { flex: showDot }
          )}
        />
        {title ? (
          <span className="text-subtitle-2 font-subtitle-2 text-neutral-900">
            {title}
          </span>
        ) : null}
      </div>
      {meta ? (
        <span
          className={SubframeUtils.twClassNames(
            "w-full text-body-2 font-body-2 text-neutral-600",
            { hidden: hideMeta }
          )}
        >
          {meta}
        </span>
      ) : null}
      {description ? (
        <span
          className={SubframeUtils.twClassNames(
            "w-full text-body-2 font-body-2 text-neutral-600",
            { hidden: hideDescription }
          )}
        >
          {description}
        </span>
      ) : null}
    </div>
  );
});

export const AuthStatusCard = AuthStatusCardRoot;
