"use client";
/*
 * Documentation:
 * Default Page Layout — https://app.subframe.com/de62b029ca8b/library?component=Default+Page+Layout_a57b1c43-310a-493f-b807-8cc88e2452cf
 * Max States — https://app.subframe.com/de62b029ca8b/library?component=Max+States_e3215ebb-cac0-4d45-8941-a2c2e1b8beab
 * Tooltip — https://app.subframe.com/de62b029ca8b/library?component=Tooltip_ccebd1e9-f6ac-4737-8376-0dfacd90c9f3
 */

import React from "react";
import { FeatherCalendar } from "@subframe/core";
import { FeatherDatabase } from "@subframe/core";
import { FeatherFolderOpen } from "@subframe/core";
import { FeatherGauge } from "@subframe/core";
import { FeatherLogOut } from "@subframe/core";
import { FeatherMessageCircleMore } from "@subframe/core";
import { FeatherNotepadText } from "@subframe/core";
import { FeatherPanelLeftOpen } from "@subframe/core";
import { FeatherRainbow } from "@subframe/core";
import { FeatherSearch } from "@subframe/core";
import { FeatherUserRound } from "@subframe/core";
import * as SubframeCore from "@subframe/core";
import { MaxStates } from "../../components/MaxStates";
import { Tooltip } from "../../components/Tooltip";
import * as SubframeUtils from "../../utils";

export interface DefaultPageLayoutRootProps
  extends React.HTMLAttributes<HTMLDivElement> {
  children?: React.ReactNode;
  className?: string;
}

const DefaultPageLayoutRoot = React.forwardRef<
  HTMLDivElement,
  DefaultPageLayoutRootProps
>(function DefaultPageLayoutRoot(
  { children, className, ...otherProps }: DefaultPageLayoutRootProps,
  ref
) {
  return (
    <div
      className={SubframeUtils.twClassNames(
        "flex h-screen w-full items-center bg-default-background",
        className
      )}
      ref={ref}
      {...otherProps}
    >
      <div className="flex grow shrink-0 basis-0 items-center self-stretch px-4 py-4 mobile:px-1 mobile:py-1">
        <div className="flex grow shrink-0 basis-0 flex-col items-center self-stretch overflow-hidden rounded-rounded-lg relative mobile:rounded-none">
          <div className="flex w-full grow shrink-0 basis-0 items-center relative z-1">
            <div className="flex items-center gap-1 self-stretch">
              <div className="flex flex-col items-center justify-between self-stretch px-2 py-4">
                <div className="flex w-full flex-col items-center gap-2">
                  <div className="flex grow shrink-0 basis-0 flex-col items-center gap-2 pt-2">
                    <div className="flex grow shrink-0 basis-0 flex-col items-center gap-2 pb-3">
                      <MaxStates className="h-11 w-11 flex-none" />
                    </div>
                    <div className="flex h-px w-full flex-none flex-col items-center gap-2 bg-neutral-border" />
                    <SubframeCore.Tooltip.Provider>
                      <SubframeCore.Tooltip.Root>
                        <SubframeCore.Tooltip.Trigger asChild={true}>
                          <div className="flex h-10 w-10 flex-none flex-col items-center justify-center gap-2 rounded-rounded-xs relative">
                            <div className="hidden h-2 w-2 flex-none flex-col items-start gap-2 rounded-full bg-error-600 absolute top-1 right-1" />
                            <div className="flex items-center gap-2">
                              <FeatherPanelLeftOpen className="font-['Inter_Tight'] text-[24px] font-[500] leading-[32px] tracking-tight text-neutral-600" />
                              <span className="hidden text-caption font-caption text-neutral-600">
                                Expand
                              </span>
                            </div>
                          </div>
                        </SubframeCore.Tooltip.Trigger>
                        <SubframeCore.Tooltip.Portal>
                          <SubframeCore.Tooltip.Content
                            side="right"
                            align="center"
                            sideOffset={4}
                            asChild={true}
                          >
                            <Tooltip>Expand</Tooltip>
                          </SubframeCore.Tooltip.Content>
                        </SubframeCore.Tooltip.Portal>
                      </SubframeCore.Tooltip.Root>
                    </SubframeCore.Tooltip.Provider>
                  </div>
                  <div className="flex w-full flex-col items-center gap-2">
                    <div className="flex w-11 flex-col items-center gap-2 relative">
                      <SubframeCore.Tooltip.Provider>
                        <SubframeCore.Tooltip.Root>
                          <SubframeCore.Tooltip.Trigger asChild={true}>
                            <div className="flex h-10 w-10 flex-none flex-col items-center justify-center gap-2 rounded-rounded-xs relative">
                              <div className="hidden h-2 w-2 flex-none flex-col items-start gap-2 rounded-full bg-error-600 absolute top-1 right-1" />
                              <div className="flex items-center gap-2">
                                <FeatherMessageCircleMore className="font-['Inter_Tight'] text-[24px] font-[500] leading-[32px] tracking-tight text-neutral-600" />
                                <span className="hidden text-caption font-caption text-neutral-600">
                                  All Chats
                                </span>
                              </div>
                            </div>
                          </SubframeCore.Tooltip.Trigger>
                          <SubframeCore.Tooltip.Portal>
                            <SubframeCore.Tooltip.Content
                              side="right"
                              align="center"
                              sideOffset={4}
                              asChild={true}
                            >
                              <Tooltip>All Chats</Tooltip>
                            </SubframeCore.Tooltip.Content>
                          </SubframeCore.Tooltip.Portal>
                        </SubframeCore.Tooltip.Root>
                      </SubframeCore.Tooltip.Provider>
                      <div className="flex h-px w-full flex-none flex-col items-center gap-2 bg-neutral-border" />
                    </div>
                  </div>
                </div>
                <div className="flex w-full grow shrink-0 basis-0 flex-col items-start gap-2 px-2 py-2" />
                <div className="flex flex-col items-center gap-2">
                  <SubframeCore.Tooltip.Provider>
                    <SubframeCore.Tooltip.Root>
                      <SubframeCore.Tooltip.Trigger asChild={true}>
                        <div className="flex h-10 w-10 flex-none flex-col items-center justify-center gap-2 rounded-rounded-xs bg-neutral-200 relative">
                          <div className="hidden h-2 w-2 flex-none flex-col items-start gap-2 rounded-full bg-error-600 absolute top-1 right-1" />
                          <div className="flex items-center gap-2">
                            <FeatherRainbow className="font-['Inter_Tight'] text-[24px] font-[500] leading-[32px] tracking-tight text-neutral-900" />
                            <span className="hidden text-caption font-caption text-neutral-600">
                              Brief
                            </span>
                          </div>
                        </div>
                      </SubframeCore.Tooltip.Trigger>
                      <SubframeCore.Tooltip.Portal>
                        <SubframeCore.Tooltip.Content
                          side="right"
                          align="center"
                          sideOffset={4}
                          asChild={true}
                        >
                          <Tooltip>Brief</Tooltip>
                        </SubframeCore.Tooltip.Content>
                      </SubframeCore.Tooltip.Portal>
                    </SubframeCore.Tooltip.Root>
                  </SubframeCore.Tooltip.Provider>
                  <SubframeCore.Tooltip.Provider>
                    <SubframeCore.Tooltip.Root>
                      <SubframeCore.Tooltip.Trigger asChild={true}>
                        <div className="flex h-10 w-10 flex-none flex-col items-center justify-center gap-2 rounded-rounded-xs relative">
                          <div className="hidden h-2 w-2 flex-none flex-col items-start gap-2 rounded-full bg-error-600 absolute top-1 right-1" />
                          <div className="flex items-center gap-2">
                            <FeatherFolderOpen className="font-['Inter_Tight'] text-[24px] font-[500] leading-[32px] tracking-tight text-neutral-600" />
                            <span className="hidden text-caption font-caption text-neutral-600">
                              Portfolio
                            </span>
                          </div>
                        </div>
                      </SubframeCore.Tooltip.Trigger>
                      <SubframeCore.Tooltip.Portal>
                        <SubframeCore.Tooltip.Content
                          side="right"
                          align="center"
                          sideOffset={4}
                          asChild={true}
                        >
                          <Tooltip>Portfolio</Tooltip>
                        </SubframeCore.Tooltip.Content>
                      </SubframeCore.Tooltip.Portal>
                    </SubframeCore.Tooltip.Root>
                  </SubframeCore.Tooltip.Provider>
                  <SubframeCore.Tooltip.Provider>
                    <SubframeCore.Tooltip.Root>
                      <SubframeCore.Tooltip.Trigger asChild={true}>
                        <div className="flex h-10 w-10 flex-none flex-col items-center justify-center gap-2 rounded-rounded-xs relative">
                          <div className="hidden h-2 w-2 flex-none flex-col items-start gap-2 rounded-full bg-error-600 absolute top-1 right-1" />
                          <div className="flex items-center gap-2">
                            <FeatherCalendar className="font-['Inter_Tight'] text-[24px] font-[500] leading-[32px] tracking-tight text-neutral-600" />
                            <span className="hidden text-caption font-caption text-neutral-600">
                              Calendar
                            </span>
                          </div>
                        </div>
                      </SubframeCore.Tooltip.Trigger>
                      <SubframeCore.Tooltip.Portal>
                        <SubframeCore.Tooltip.Content
                          side="right"
                          align="center"
                          sideOffset={4}
                          asChild={true}
                        >
                          <Tooltip>Calendar</Tooltip>
                        </SubframeCore.Tooltip.Content>
                      </SubframeCore.Tooltip.Portal>
                    </SubframeCore.Tooltip.Root>
                  </SubframeCore.Tooltip.Provider>
                  <SubframeCore.Tooltip.Provider>
                    <SubframeCore.Tooltip.Root>
                      <SubframeCore.Tooltip.Trigger asChild={true}>
                        <div className="flex h-10 w-10 flex-none flex-col items-center justify-center gap-2 rounded-rounded-xs relative">
                          <div className="hidden h-2 w-2 flex-none flex-col items-start gap-2 rounded-full bg-error-600 absolute top-1 right-1" />
                          <div className="flex items-center gap-2">
                            <FeatherGauge className="font-['Inter_Tight'] text-[24px] font-[500] leading-[32px] tracking-tight text-neutral-600" />
                            <span className="hidden text-caption font-caption text-neutral-600">
                              Mission Control
                            </span>
                          </div>
                        </div>
                      </SubframeCore.Tooltip.Trigger>
                      <SubframeCore.Tooltip.Portal>
                        <SubframeCore.Tooltip.Content
                          side="right"
                          align="center"
                          sideOffset={4}
                          asChild={true}
                        >
                          <Tooltip>Mission Control</Tooltip>
                        </SubframeCore.Tooltip.Content>
                      </SubframeCore.Tooltip.Portal>
                    </SubframeCore.Tooltip.Root>
                  </SubframeCore.Tooltip.Provider>
                  <SubframeCore.Tooltip.Provider>
                    <SubframeCore.Tooltip.Root>
                      <SubframeCore.Tooltip.Trigger asChild={true}>
                        <div className="flex h-10 w-10 flex-none flex-col items-center justify-center gap-2 rounded-rounded-xs relative">
                          <div className="hidden h-2 w-2 flex-none flex-col items-start gap-2 rounded-full bg-error-600 absolute top-1 right-1" />
                          <div className="flex items-center gap-2">
                            <FeatherNotepadText className="font-['Inter_Tight'] text-[24px] font-[500] leading-[32px] tracking-tight text-neutral-600" />
                            <span className="hidden text-caption font-caption text-neutral-600">
                              Artifact
                            </span>
                          </div>
                        </div>
                      </SubframeCore.Tooltip.Trigger>
                      <SubframeCore.Tooltip.Portal>
                        <SubframeCore.Tooltip.Content
                          side="right"
                          align="center"
                          sideOffset={4}
                          asChild={true}
                        >
                          <Tooltip>Artifact</Tooltip>
                        </SubframeCore.Tooltip.Content>
                      </SubframeCore.Tooltip.Portal>
                    </SubframeCore.Tooltip.Root>
                  </SubframeCore.Tooltip.Provider>
                  <SubframeCore.Tooltip.Provider>
                    <SubframeCore.Tooltip.Root>
                      <SubframeCore.Tooltip.Trigger asChild={true}>
                        <div className="flex h-10 w-10 flex-none flex-col items-center justify-center gap-2 rounded-rounded-xs relative">
                          <div className="hidden h-2 w-2 flex-none flex-col items-start gap-2 rounded-full bg-error-600 absolute top-1 right-1" />
                          <div className="flex items-center gap-2">
                            <FeatherDatabase className="font-['Inter_Tight'] text-[24px] font-[500] leading-[32px] tracking-tight text-neutral-600" />
                            <span className="hidden text-caption font-caption text-neutral-600">
                              My Data
                            </span>
                          </div>
                        </div>
                      </SubframeCore.Tooltip.Trigger>
                      <SubframeCore.Tooltip.Portal>
                        <SubframeCore.Tooltip.Content
                          side="right"
                          align="center"
                          sideOffset={4}
                          asChild={true}
                        >
                          <Tooltip>My Data</Tooltip>
                        </SubframeCore.Tooltip.Content>
                      </SubframeCore.Tooltip.Portal>
                    </SubframeCore.Tooltip.Root>
                  </SubframeCore.Tooltip.Provider>
                </div>
                <div className="flex w-full grow shrink-0 basis-0 flex-col items-start gap-2 px-2 py-2" />
                <div className="flex flex-col items-center gap-2">
                  <div className="flex h-px w-full flex-none flex-col items-center gap-2 bg-neutral-border" />
                  <SubframeCore.Tooltip.Provider>
                    <SubframeCore.Tooltip.Root>
                      <SubframeCore.Tooltip.Trigger asChild={true}>
                        <div className="flex h-10 w-10 flex-none flex-col items-center justify-center gap-2 rounded-rounded-xs relative">
                          <div className="hidden h-2 w-2 flex-none flex-col items-start gap-2 rounded-full bg-error-600 absolute top-1 right-1" />
                          <div className="flex items-center gap-2">
                            <FeatherSearch className="font-['Inter_Tight'] text-[24px] font-[500] leading-[32px] tracking-tight text-neutral-600" />
                            <span className="hidden text-caption font-caption text-neutral-600">
                              Search
                            </span>
                          </div>
                        </div>
                      </SubframeCore.Tooltip.Trigger>
                      <SubframeCore.Tooltip.Portal>
                        <SubframeCore.Tooltip.Content
                          side="right"
                          align="center"
                          sideOffset={4}
                          asChild={true}
                        >
                          <Tooltip>Search</Tooltip>
                        </SubframeCore.Tooltip.Content>
                      </SubframeCore.Tooltip.Portal>
                    </SubframeCore.Tooltip.Root>
                  </SubframeCore.Tooltip.Provider>
                  <SubframeCore.Tooltip.Provider>
                    <SubframeCore.Tooltip.Root>
                      <SubframeCore.Tooltip.Trigger asChild={true}>
                        <div className="flex h-10 w-10 flex-none flex-col items-center justify-center gap-2 rounded-rounded-xs relative">
                          <div className="hidden h-2 w-2 flex-none flex-col items-start gap-2 rounded-full bg-error-600 absolute top-1 right-1" />
                          <div className="flex items-center gap-2">
                            <FeatherUserRound className="font-['Inter_Tight'] text-[24px] font-[500] leading-[32px] tracking-tight text-neutral-600" />
                            <span className="hidden text-caption font-caption text-neutral-600">
                              My Profile
                            </span>
                          </div>
                        </div>
                      </SubframeCore.Tooltip.Trigger>
                      <SubframeCore.Tooltip.Portal>
                        <SubframeCore.Tooltip.Content
                          side="right"
                          align="center"
                          sideOffset={4}
                          asChild={true}
                        >
                          <Tooltip>My Profile</Tooltip>
                        </SubframeCore.Tooltip.Content>
                      </SubframeCore.Tooltip.Portal>
                    </SubframeCore.Tooltip.Root>
                  </SubframeCore.Tooltip.Provider>
                  <SubframeCore.Tooltip.Provider>
                    <SubframeCore.Tooltip.Root>
                      <SubframeCore.Tooltip.Trigger asChild={true}>
                        <div className="flex h-10 w-10 flex-none flex-col items-center justify-center gap-2 rounded-rounded-xs relative">
                          <div className="hidden h-2 w-2 flex-none flex-col items-start gap-2 rounded-full bg-error-600 absolute top-1 right-1" />
                          <div className="flex items-center gap-2">
                            <FeatherLogOut className="font-['Inter_Tight'] text-[24px] font-[500] leading-[32px] tracking-tight text-error-600" />
                            <span className="hidden text-caption font-caption text-error-600">
                              Log Out
                            </span>
                          </div>
                        </div>
                      </SubframeCore.Tooltip.Trigger>
                      <SubframeCore.Tooltip.Portal>
                        <SubframeCore.Tooltip.Content
                          side="right"
                          align="center"
                          sideOffset={4}
                          asChild={true}
                        >
                          <Tooltip>Log Out</Tooltip>
                        </SubframeCore.Tooltip.Content>
                      </SubframeCore.Tooltip.Portal>
                    </SubframeCore.Tooltip.Root>
                  </SubframeCore.Tooltip.Provider>
                </div>
              </div>
              <div className="hidden w-px flex-none flex-col items-center gap-2 self-stretch bg-neutral-border" />
            </div>
            <div className="container max-w-none flex grow shrink-0 basis-0 items-start justify-center self-stretch">
              {children ? (
                <div className="flex grow shrink-0 basis-0 flex-col items-center gap-4 self-stretch overflow-hidden overflow-y-auto">
                  {children}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
});

export const DefaultPageLayout = DefaultPageLayoutRoot;
