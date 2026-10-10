"use client";
/*
 * Documentation:
 * Logo Mark — https://app.subframe.com/de62b029ca8b/library?component=Logo+Mark_f69f9752-0b93-4164-966a-e2ed9de62a1a
 */

import React from "react";
import LogoBeroe from "../../icons/LogoBeroe";
import LogoMax from "../../icons/LogoMax";
import * as SubframeUtils from "../../utils";

export interface LogoMarkRootProps
  extends React.HTMLAttributes<HTMLDivElement> {
  className?: string;
}

const LogoMarkRoot = React.forwardRef<HTMLDivElement, LogoMarkRootProps>(
  function LogoMarkRoot({ className, ...otherProps }: LogoMarkRootProps, ref) {
    return (
      <div
        className={SubframeUtils.twClassNames(
          "flex items-center gap-2",
          className
        )}
        ref={ref}
        {...otherProps}
      >
        <div className="hidden flex-col items-start gap-2">
          <div className="flex h-24 w-40 flex-none items-center gap-0.5 relative">
            <LogoBeroe className="font-['Inter_Tight'] text-[120px] font-[400] leading-[14px] text-alpha-slate-100 absolute inset-0" />
            <LogoMax className="font-['Inter_Tight'] text-[120px] font-[400] leading-[14px] text-brand-primary absolute inset-0 w-full h-full" />
          </div>
        </div>
        <img
          className="h-20 grow shrink-0 basis-0 object-contain"
          src="https://res.cloudinary.com/subframe/image/upload/v1779088580/uploads/13599/umuo3ewiydxrlr6g2q0a.svg"
        />
      </div>
    );
  }
);

export const LogoMark = LogoMarkRoot;
