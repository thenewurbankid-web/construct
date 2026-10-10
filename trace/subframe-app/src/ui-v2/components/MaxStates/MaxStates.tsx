"use client";
/*
 * Documentation:
 * Max States — https://app.subframe.com/de62b029ca8b/library?component=Max+States_e3215ebb-cac0-4d45-8941-a2c2e1b8beab
 */

import React from "react";
import * as SubframeUtils from "../../utils";

export interface MaxStatesRootProps
  extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "default" | "question" | "thinking" | "data" | "chat" | "error";
  className?: string;
}

const MaxStatesRoot = React.forwardRef<HTMLDivElement, MaxStatesRootProps>(
  function MaxStatesRoot(
    { variant = "default", className, ...otherProps }: MaxStatesRootProps,
    ref
  ) {
    return (
      <div
        className={SubframeUtils.twClassNames(
          "group/e3215ebb flex h-12 w-12 flex-col items-start gap-2",
          className
        )}
        ref={ref}
        {...otherProps}
      >
        <img
          className="w-full grow shrink-0 basis-0 object-contain"
          src={
            variant === "error"
              ? "https://res.cloudinary.com/subframe/image/upload/v1772223562/uploads/13599/ke9phd7ra7kozladsr37.png"
              : variant === "chat"
              ? "https://res.cloudinary.com/subframe/image/upload/v1770018996/uploads/13599/j9sffhgjqdegfpz5ewdg.png"
              : variant === "data"
              ? "https://res.cloudinary.com/subframe/image/upload/v1759828615/uploads/13599/ums9zjyhuenoqkritsed.png"
              : variant === "thinking"
              ? "https://res.cloudinary.com/subframe/image/upload/v1759828618/uploads/13599/vfooi7al1tmavnjnwyhe.png"
              : variant === "question"
              ? "https://res.cloudinary.com/subframe/image/upload/v1759828615/uploads/13599/fmkwnlhy4qqbmlau8llw.png"
              : "https://res.cloudinary.com/subframe/image/upload/v1772114129/uploads/13599/csa73td6upn7sia7latl.png"
          }
        />
      </div>
    );
  }
);

export const MaxStates = MaxStatesRoot;
