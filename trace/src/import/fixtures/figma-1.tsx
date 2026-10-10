"use client";

import React from "react";
import { Avatar } from "@/ui-v2/components/Avatar";
import { Badge } from "@/ui-v2/components/Badge";
import { Breadcrumbs } from "@/ui-v2/components/Breadcrumbs";
import { Button } from "@/ui-v2/components/Button";
import { IconButton } from "@/ui-v2/components/IconButton";
import { SideNav } from "@/ui-v2/components/SideNav";
import { Table } from "@/ui-v2/components/Table";
import { FeatherActivity } from "@subframe/core";
import { FeatherBriefcase } from "@subframe/core";
import { FeatherChevronDown } from "@subframe/core";
import { FeatherChevronRight } from "@subframe/core";
import { FeatherFileText } from "@subframe/core";
import { FeatherGauge } from "@subframe/core";
import { FeatherHome } from "@subframe/core";
import { FeatherListChecks } from "@subframe/core";
import { FeatherMessageSquare } from "@subframe/core";
import { FeatherSearch } from "@subframe/core";
import { FeatherShield } from "@subframe/core";
import { FeatherSparkles } from "@subframe/core";

function PortfolioHealthFigmaRebuild() {
  return (
    <div className="flex h-full w-full bg-neutral-50 items-stretch">
      <SideNav
        className="bg-default-background mobile:hidden"
        mainMenu={
          <>
            <SideNav.NavItem icon={<FeatherHome />} collapsed={true} />
            <SideNav.NavItem icon={<FeatherListChecks />} collapsed={true} />
            <SideNav.NavItem icon={<FeatherShield />} collapsed={true} />
            <SideNav.NavItem
              className="bg-brand-25 hover:bg-brand-25"
              icon={<FeatherGauge />}
              selected={true}
              collapsed={true}
            />
            <SideNav.NavItem icon={<FeatherActivity />} collapsed={true} />
            <SideNav.NavItem icon={<FeatherMessageSquare />} collapsed={true} />
            <SideNav.NavItem icon={<FeatherFileText />} collapsed={true} />
            <SideNav.NavItem icon={<FeatherSparkles />} collapsed={true} />
          </>
        }
        collapsed={true}
      />
      <div className="flex grow shrink-0 basis-0 flex-col items-start self-stretch overflow-y-auto">
        <div className="flex w-full items-center justify-between border-b border-solid border-neutral-border bg-default-background px-6 py-3 mobile:px-4">
          <Breadcrumbs>
            <Breadcrumbs.Item icon={true} icon2={<FeatherActivity />}>
              Health
            </Breadcrumbs.Item>
            <Breadcrumbs.Divider />
            <div className="flex items-center gap-1 rounded-full bg-brand-25 px-2.5 py-1">
              <FeatherBriefcase className="text-caption font-caption text-brand-600" />
              <span className="text-caption font-caption text-brand-700">
                My Portfolio
              </span>
              <FeatherChevronDown className="text-caption font-caption text-brand-600" />
            </div>
          </Breadcrumbs>
          <div className="flex items-center gap-3">
            <IconButton
              variant="ghost"
              size="xsmall"
              icon={<FeatherSearch />}
              onClick={(event: React.MouseEvent<HTMLButtonElement>) => {}}
            />
            <div className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-brand-100 shadow-[0px_0px_12px_0px_#4a00f87a]">
              <div className="flex h-3.5 w-3.5 flex-none items-start rounded-full bg-gradient-to-br from-brand-300 to-brand-600" />
            </div>
            <div className="flex items-center gap-1.5 rounded-full border border-solid border-neutral-border pl-1 pr-2 py-1">
              <Avatar variant="brand" size="x-small" image="">
                PN
              </Avatar>
              <span className="text-caption font-caption text-default-font mobile:hidden">
                Prerna
              </span>
              <FeatherChevronDown className="text-caption font-caption text-subtext-color" />
            </div>
          </div>
        </div>
        <div className="flex w-full max-w-[960px] flex-col items-start gap-12 px-6 py-8 self-center mobile:gap-8 mobile:px-4">
          <div className="flex w-full flex-col items-start gap-5">
            <div className="flex w-full items-start gap-12 border-b border-solid border-neutral-border pb-4 mobile:flex-wrap mobile:gap-6">
              <div className="flex flex-col items-start gap-1">
                <span className="text-overline-xs-mono font-overline-xs-mono text-neutral-400 uppercase">
                  Your categories
                </span>
                <span className="text-caption-mono font-caption-mono text-default-font">
                  6
                </span>
              </div>
              <div className="flex flex-col items-start gap-1">
                <span className="text-overline-xs-mono font-overline-xs-mono text-neutral-400 uppercase">
                  Spend you manage
                </span>
                <span className="text-caption-mono font-caption-mono text-default-font">
                  $280.2M
                </span>
              </div>
              <div className="flex flex-col items-start gap-1">
                <span className="text-overline-xs-mono font-overline-xs-mono text-neutral-400 uppercase">
                  Refreshed
                </span>
                <span className="text-caption-mono font-caption-mono text-default-font">
                  31 Jul 2026
                </span>
              </div>
            </div>
            <div className="flex w-full flex-col items-start gap-4">
              <div className="flex w-full items-center gap-2">
                <div className="flex h-3 w-3 flex-none items-center justify-center rounded-full bg-brand-50">
                  <div className="flex h-1.5 w-1.5 flex-none items-start rounded-full bg-brand-500" />
                </div>
                <span className="whitespace-nowrap text-overline-xs-mono font-overline-xs-mono text-brand-600 uppercase">
                  MAX · Your portfolio summary
                </span>
                <div className="flex h-px grow shrink-0 basis-0 items-start bg-brand-50" />
              </div>
              <span className="line-clamp-2 max-w-[480px] text-h5-max font-h5-max text-default-font mobile:text-h6-max mobile:font-h6-max">
                Grains is carrying your portfolio. Logistics and Packaging are
                not.
              </span>
              <div className="flex max-w-[560px] flex-col items-start gap-3">
                <span className="text-body-2-max font-body-2-max text-neutral-700">
                  Improving: Grains, up on contract coverage and a renegotiated
                  origination mix, and Chemicals, where the solvent index fell
                  two quarters running.
                </span>
                <span className="text-body-2-max font-body-2-max text-neutral-700">
                  Declining: Logistics, where the maturity gap widened to -0.7
                  and three high flags are open, and Packaging, where supplier
                  concentration moved the wrong way. IT &amp; Software is flat.
                  There is no single portfolio score here on purpose - averaging
                  six categories produces a number that means nothing.
                </span>
              </div>
            </div>
          </div>
          <div className="flex w-full flex-col items-start gap-4">
            <div className="flex w-full items-center gap-3">
              <span className="whitespace-nowrap text-subtitle-1 font-subtitle-1 text-default-font">
                Your portfolio at a glance
              </span>
              <div className="flex h-px grow shrink-0 basis-0 items-start bg-neutral-border" />
            </div>
            <div className="flex w-full flex-col items-start rounded-rounded-md border border-solid border-neutral-border bg-default-background px-2 py-2 shadow-xs">
              <div className="flex w-full gap-2 items-stretch mobile:flex-col">
                <div className="flex grow shrink-0 basis-0 flex-col items-start gap-2 rounded-rounded-sm bg-neutral-100 px-4 py-4">
                  <span className="text-overline-xs-mono font-overline-xs-mono text-neutral-500 uppercase">
                    Spend you manage · T12M
                  </span>
                  <div className="flex items-end gap-0.5">
                    <span className="text-h4-max font-h4-max text-default-font">
                      $280
                    </span>
                    <span className="text-subtitle-1-max font-subtitle-1-max text-default-font">
                      M
                    </span>
                  </div>
                  <span className="text-caption-mono font-caption-mono text-success-600">
                    ▲ 8.4% YoY
                  </span>
                  <span className="text-caption font-caption text-subtext-color">
                    Across the six categories assigned to you. Grains &amp;
                    Cereals is 33% of it.
                  </span>
                </div>
                <div className="flex grow shrink-0 basis-0 flex-col items-start gap-2 px-4 py-4">
                  <span className="text-overline-xs-mono font-overline-xs-mono text-neutral-500 uppercase">
                    Savings potential
                  </span>
                  <div className="flex items-end gap-0.5">
                    <span className="text-h4-max font-h4-max text-default-font">
                      $24.5
                    </span>
                    <span className="text-subtitle-1-max font-subtitle-1-max text-default-font">
                      M
                    </span>
                  </div>
                  <span className="text-caption-mono font-caption-mono text-success-600">
                    38% of qualified savings initiatives accepted
                  </span>
                  <span className="text-caption font-caption text-subtext-color">
                    Sum of the mid-point estimate from each of your six
                    categories. 23 of 60 qualified initiatives have been
                    accepted.
                  </span>
                </div>
              </div>
              <div className="flex h-px w-full flex-none items-start bg-neutral-border my-2" />
              <div className="flex w-full items-stretch mobile:flex-col">
                <div className="flex grow shrink-0 basis-0 flex-col items-start gap-2 px-4 py-4">
                  <span className="text-overline-xs-mono font-overline-xs-mono text-neutral-500 uppercase">
                    Resilience based initiatives
                  </span>
                  <span className="text-h4-max font-h4-max text-default-font">
                    21
                  </span>
                  <div className="flex flex-col items-start gap-1">
                    <div className="flex items-center gap-1">
                      <div className="flex h-3 w-3 flex-none items-start rounded-[3px] bg-error-500" />
                      <div className="flex h-3 w-3 flex-none items-start rounded-[3px] bg-error-500" />
                      <div className="flex h-3 w-3 flex-none items-start rounded-[3px] bg-error-500" />
                      <div className="flex h-3 w-3 flex-none items-start rounded-[3px] bg-error-500" />
                      <div className="flex h-3 w-3 flex-none items-start rounded-[3px] bg-error-500" />
                      <div className="flex h-3 w-3 flex-none items-start rounded-[3px] bg-error-500" />
                      <div className="flex h-3 w-3 flex-none items-start rounded-[3px] bg-error-500" />
                      <div className="flex h-3 w-3 flex-none items-start rounded-[3px] bg-warning-500" />
                      <div className="flex h-3 w-3 flex-none items-start rounded-[3px] bg-warning-500" />
                      <div className="flex h-3 w-3 flex-none items-start rounded-[3px] bg-warning-500" />
                      <div className="flex h-3 w-3 flex-none items-start rounded-[3px] bg-warning-500" />
                    </div>
                    <div className="flex items-center gap-1">
                      <div className="flex h-3 w-3 flex-none items-start rounded-[3px] bg-warning-500" />
                      <div className="flex h-3 w-3 flex-none items-start rounded-[3px] bg-warning-500" />
                      <div className="flex h-3 w-3 flex-none items-start rounded-[3px] bg-warning-500" />
                      <div className="flex h-3 w-3 flex-none items-start rounded-[3px] bg-warning-500" />
                      <div className="flex h-3 w-3 flex-none items-start rounded-[3px] bg-warning-500" />
                      <div className="flex h-3 w-3 flex-none items-start rounded-[3px] bg-warning-500" />
                      <div className="flex h-3 w-3 flex-none items-start rounded-[3px] bg-warning-500" />
                      <div className="flex h-3 w-3 flex-none items-start rounded-[3px] bg-warning-500" />
                      <div className="flex h-3 w-3 flex-none items-start rounded-[3px] bg-warning-500" />
                      <div className="flex h-3 w-3 flex-none items-start rounded-[3px] bg-neutral-300" />
                    </div>
                  </div>
                  <span className="text-caption-mono font-caption-mono text-neutral-700">
                    7 high · 13 medium · 1 low.
                  </span>
                  <span className="text-caption font-caption text-subtext-color">
                    4 categories carry at least one high.
                  </span>
                </div>
                <div className="flex w-px flex-none items-start self-stretch bg-neutral-border mobile:h-px mobile:w-full mobile:flex-none" />
                <div className="flex grow shrink-0 basis-0 flex-col items-start gap-2 px-4 py-4">
                  <span className="text-overline-xs-mono font-overline-xs-mono text-neutral-500 uppercase">
                    Number of savings initiatives
                  </span>
                  <span className="text-h4-max font-h4-max text-default-font">
                    26
                  </span>
                  <div className="flex w-full flex-col items-end gap-1 pt-2">
                    <div className="flex w-full items-center gap-0.5 relative">
                      <div className="flex h-1.5 items-start rounded-l-full bg-error-500 w-[40%]" />
                      <div className="flex h-1.5 items-start bg-warning-500 w-[35%]" />
                      <div className="flex h-1.5 grow shrink-0 basis-0 items-start rounded-r-full bg-neutral-300" />
                      <div className="flex h-3.5 w-0.5 flex-none items-start rounded-full bg-default-font absolute right-[18%] -top-1" />
                    </div>
                    <span className="text-caption-xs-mono font-caption-xs-mono text-subtext-color">
                      target $42.0M
                    </span>
                  </div>
                  <span className="text-caption font-caption text-subtext-color">
                    Savings initiatives raised but not yet accepted by an owner.
                    Oldest has been waiting 34 days.
                  </span>
                </div>
                <div className="flex w-px flex-none items-start self-stretch bg-neutral-border mobile:h-px mobile:w-full mobile:flex-none" />
                <div className="flex grow shrink-0 basis-0 flex-col items-start gap-2 px-4 py-4">
                  <span className="text-overline-xs-mono font-overline-xs-mono text-neutral-500 uppercase">
                    Risk initiatives
                  </span>
                  <span className="text-h4-max font-h4-max text-warning-600">
                    6
                  </span>
                  <span className="text-caption-mono font-caption-mono text-neutral-700">
                    resilience initiatives · 2 categories
                  </span>
                  <div className="flex w-full flex-col items-end gap-1 pt-2">
                    <div className="flex w-full items-center gap-0.5 relative">
                      <div className="flex h-1.5 items-start rounded-l-full bg-error-500 w-[30%]" />
                      <div className="flex h-1.5 items-start bg-warning-500 w-[45%]" />
                      <div className="flex h-1.5 grow shrink-0 basis-0 items-start rounded-r-full bg-neutral-300" />
                      <div className="flex h-3.5 w-0.5 flex-none items-start rounded-full bg-default-font absolute right-[12%] -top-1" />
                    </div>
                    <span className="text-caption-xs-mono font-caption-xs-mono text-subtext-color">
                      target 8.0
                    </span>
                  </div>
                  <span className="text-caption font-caption text-subtext-color">
                    Risk reduction awaiting a decision. Not measured in savings,
                    so it is counted separately.
                  </span>
                </div>
              </div>
            </div>
          </div>
          <div className="flex w-full flex-col items-start gap-3">
            <div className="flex w-full items-center gap-2">
              <FeatherSparkles className="text-caption font-caption text-brand-600" />
              <span className="whitespace-nowrap text-caption font-caption text-brand-600">
                Ask Anything about your portfolio
              </span>
              <div className="flex h-px grow shrink-0 basis-0 items-start border-t border-dotted border-brand-300" />
            </div>
            <div className="flex items-center gap-3 rounded-rounded-sm border border-dashed border-brand-300 bg-default-background px-3 py-2 mobile:w-full mobile:flex-none mobile:flex-col mobile:items-start">
              <span className="text-overline-xs-mono font-overline-xs-mono text-subtext-color uppercase">
                Suggestions
              </span>
              <Button
                variant="brand-subtle"
                size="xsmall"
                iconRight={<FeatherChevronDown />}
                onClick={(event: React.MouseEvent<HTMLButtonElement>) => {}}
              >
                Prompt suggestion 01
              </Button>
              <Button
                variant="brand-subtle"
                size="xsmall"
                iconRight={<FeatherChevronDown />}
                onClick={(event: React.MouseEvent<HTMLButtonElement>) => {}}
              >
                Prompt suggestion 02
              </Button>
            </div>
          </div>
          <div className="flex w-full flex-col items-start gap-4">
            <div className="flex flex-col items-start gap-1">
              <span className="text-subtitle-1 font-subtitle-1 text-default-font">
                Category overview
              </span>
              <span className="max-w-[520px] text-caption font-caption text-subtext-color">
                Order based on top spend categories (Top 10) within that ordered
                by the ones needing max attention. Open any row for the full
                scorecard.
              </span>
            </div>
            <div className="flex w-full flex-col items-start overflow-hidden rounded-rounded-md border border-solid border-neutral-border bg-default-background shadow-xs">
              <div className="flex w-full flex-col items-start overflow-x-auto">
                <Table
                  className="min-w-[860px]"
                  header={
                    <Table.HeaderRow>
                      <Table.HeaderCell>#</Table.HeaderCell>
                      <Table.HeaderCell>Category</Table.HeaderCell>
                      <Table.HeaderCell variant="right-aligned">
                        Spend
                      </Table.HeaderCell>
                      <Table.HeaderCell>Maturity</Table.HeaderCell>
                      <Table.HeaderCell>Savings potential</Table.HeaderCell>
                      <Table.HeaderCell>Needs attention</Table.HeaderCell>
                      <Table.HeaderCell>Trend</Table.HeaderCell>
                      <Table.HeaderCell />
                    </Table.HeaderRow>
                  }
                >
                  <Table.Row className="bg-error-50" clickable={true}>
                    <Table.Cell>
                      <span className="text-caption-mono font-caption-mono text-neutral-400">
                        01
                      </span>
                    </Table.Cell>
                    <Table.Cell className="py-3">
                      <div className="flex flex-col items-start gap-1.5 py-3">
                        <div className="flex items-center gap-2">
                          <span className="text-subtitle-2 font-subtitle-2 text-default-font">
                            Logistics
                          </span>
                          <span className="text-caption-xs-mono font-caption-xs-mono text-neutral-500 rounded-[4px] bg-neutral-100 px-1">
                            L3
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-1">
                          <Badge variant="error" size="xs">
                            3 high flags
                          </Badge>
                          <Badge variant="error" size="xs">
                            widest maturity gap -0.7
                          </Badge>
                          <Badge variant="error" size="xs">
                            $740K overdue 12d
                          </Badge>
                        </div>
                      </div>
                    </Table.Cell>
                    <Table.Cell variant="right-aligned">
                      <div className="flex flex-col items-end">
                        <span className="text-body-2-mono font-body-2-mono text-default-font">
                          $38.4M
                        </span>
                        <span className="text-caption-xs-mono font-caption-xs-mono text-subtext-color">
                          13.7%
                        </span>
                      </div>
                    </Table.Cell>
                    <Table.Cell>
                      <div className="flex flex-col items-start">
                        <div className="flex items-center gap-1.5">
                          <span className="text-body-2-mono font-body-2-mono text-default-font">
                            2.0
                          </span>
                          <span className="text-caption-xs-mono font-caption-xs-mono text-error-600">
                            -0.7
                          </span>
                        </div>
                        <span className="text-caption-xs-mono font-caption-xs-mono text-subtext-color">
                          peer 2.7
                        </span>
                      </div>
                    </Table.Cell>
                    <Table.Cell>
                      <div className="flex w-28 flex-none flex-col items-start gap-1.5">
                        <div className="flex w-full items-center gap-1.5">
                          <span className="text-body-2-mono font-body-2-mono text-default-font">
                            $5.6M
                          </span>
                          <span className="text-caption-xs-mono font-caption-xs-mono text-subtext-color">
                            14.6%
                          </span>
                        </div>
                        <div className="flex h-1 w-full flex-none items-start overflow-hidden rounded-full bg-alpha-slate-8">
                          <div className="flex items-start self-stretch rounded-full bg-data-viz-categorical-01 w-[58%]" />
                        </div>
                      </div>
                    </Table.Cell>
                    <Table.Cell>
                      <div className="flex items-center gap-1">
                        <div className="flex h-2.5 w-2.5 flex-none items-start rounded-[3px] bg-error-500" />
                        <div className="flex h-2.5 w-2.5 flex-none items-start rounded-[3px] bg-error-500" />
                        <div className="flex h-2.5 w-2.5 flex-none items-start rounded-[3px] bg-error-500" />
                        <div className="flex h-2.5 w-2.5 flex-none items-start rounded-[3px] bg-warning-500" />
                      </div>
                    </Table.Cell>
                    <Table.Cell>
                      <svg
                        className="text-body-2 font-body-2 text-error-500"
                        width="1em"
                        height="1em"
                        viewBox="0 0 64 20"
                      >
                        <path
                          d="m2 6 12 2 12-1 12 5 12 2 12 4"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeOpacity="1"
                        />
                      </svg>
                    </Table.Cell>
                    <Table.Cell variant="right-aligned">
                      <FeatherChevronRight className="text-body-2 font-body-2 text-neutral-400" />
                    </Table.Cell>
                  </Table.Row>
                  <Table.Row className="bg-error-50" clickable={true}>
                    <Table.Cell>
                      <span className="text-caption-mono font-caption-mono text-neutral-400">
                        02
                      </span>
                    </Table.Cell>
                    <Table.Cell className="py-3">
                      <div className="flex flex-col items-start gap-1.5 py-3">
                        <div className="flex items-center gap-2">
                          <span className="text-subtitle-2 font-subtitle-2 text-default-font">
                            Packaging
                          </span>
                          <span className="text-caption-xs-mono font-caption-xs-mono text-neutral-500 rounded-[4px] bg-neutral-100 px-1">
                            L2
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-1">
                          <Badge variant="error" size="xs">
                            largest unclaimed $7.1M
                          </Badge>
                          <Badge variant="error" size="xs">
                            2 high flags
                          </Badge>
                          <Badge variant="error" size="xs">
                            $1.1M due in 3d
                          </Badge>
                        </div>
                      </div>
                    </Table.Cell>
                    <Table.Cell variant="right-aligned">
                      <div className="flex flex-col items-end">
                        <span className="text-body-2-mono font-body-2-mono text-default-font">
                          $62.8M
                        </span>
                        <span className="text-caption-xs-mono font-caption-xs-mono text-subtext-color">
                          22.4%
                        </span>
                      </div>
                    </Table.Cell>
                    <Table.Cell>
                      <div className="flex flex-col items-start">
                        <div className="flex items-center gap-1.5">
                          <span className="text-body-2-mono font-body-2-mono text-default-font">
                            1.8
                          </span>
                          <span className="text-caption-xs-mono font-caption-xs-mono text-error-600">
                            -0.6
                          </span>
                        </div>
                        <span className="text-caption-xs-mono font-caption-xs-mono text-subtext-color">
                          peer 2.4
                        </span>
                      </div>
                    </Table.Cell>
                    <Table.Cell>
                      <div className="flex w-28 flex-none flex-col items-start gap-1.5">
                        <div className="flex w-full items-center gap-1.5">
                          <span className="text-body-2-mono font-body-2-mono text-default-font">
                            $7.1M
                          </span>
                          <span className="text-caption-xs-mono font-caption-xs-mono text-subtext-color">
                            11.3%
                          </span>
                        </div>
                        <div className="flex h-1 w-full flex-none items-start overflow-hidden rounded-full bg-alpha-slate-8">
                          <div className="flex items-start self-stretch rounded-full bg-data-viz-categorical-01 w-[45%]" />
                        </div>
                      </div>
                    </Table.Cell>
                    <Table.Cell>
                      <div className="flex items-center gap-1">
                        <div className="flex h-2.5 w-2.5 flex-none items-start rounded-[3px] bg-error-500" />
                        <div className="flex h-2.5 w-2.5 flex-none items-start rounded-[3px] bg-error-500" />
                        <div className="flex h-2.5 w-2.5 flex-none items-start rounded-[3px] bg-warning-500" />
                        <div className="flex h-2.5 w-2.5 flex-none items-start rounded-[3px] bg-warning-500" />
                      </div>
                    </Table.Cell>
                    <Table.Cell>
                      <svg
                        className="text-body-2 font-body-2 text-warning-500"
                        width="1em"
                        height="1em"
                        viewBox="0 0 64 20"
                      >
                        <path
                          d="m2 12 12-1 12 2 12-1 12 1 12-1"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeOpacity="1"
                        />
                      </svg>
                    </Table.Cell>
                    <Table.Cell variant="right-aligned">
                      <FeatherChevronRight className="text-body-2 font-body-2 text-neutral-400" />
                    </Table.Cell>
                  </Table.Row>
                  <Table.Row clickable={true}>
                    <Table.Cell>
                      <span className="text-caption-mono font-caption-mono text-neutral-400">
                        03
                      </span>
                    </Table.Cell>
                    <Table.Cell className="py-3">
                      <div className="flex flex-col items-start gap-1.5 py-3">
                        <div className="flex items-center gap-2">
                          <span className="text-subtitle-2 font-subtitle-2 text-default-font">
                            IT Services
                          </span>
                          <span className="text-caption-xs-mono font-caption-xs-mono text-neutral-500 rounded-[4px] bg-neutral-100 px-1">
                            L3
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-1">
                          <Badge variant="error" size="xs">
                            single supplier 9.5%
                          </Badge>
                          <Badge variant="error" size="xs">
                            $410K past due
                          </Badge>
                          <Badge variant="neutral" size="xs">
                            maturity flat 2 quarters
                          </Badge>
                        </div>
                      </div>
                    </Table.Cell>
                    <Table.Cell variant="right-aligned">
                      <div className="flex flex-col items-end">
                        <span className="text-body-2-mono font-body-2-mono text-default-font">
                          $45.2M
                        </span>
                        <span className="text-caption-xs-mono font-caption-xs-mono text-subtext-color">
                          16.1%
                        </span>
                      </div>
                    </Table.Cell>
                    <Table.Cell>
                      <div className="flex flex-col items-start">
                        <div className="flex items-center gap-1.5">
                          <span className="text-body-2-mono font-body-2-mono text-default-font">
                            2.1
                          </span>
                          <span className="text-caption-xs-mono font-caption-xs-mono text-error-600">
                            -0.5
                          </span>
                        </div>
                        <span className="text-caption-xs-mono font-caption-xs-mono text-subtext-color">
                          peer 2.6
                        </span>
                      </div>
                    </Table.Cell>
                    <Table.Cell>
                      <div className="flex w-28 flex-none flex-col items-start gap-1.5">
                        <div className="flex w-full items-center gap-1.5">
                          <span className="text-body-2-mono font-body-2-mono text-default-font">
                            $4.2M
                          </span>
                          <span className="text-caption-xs-mono font-caption-xs-mono text-subtext-color">
                            9.3%
                          </span>
                        </div>
                        <div className="flex h-1 w-full flex-none items-start overflow-hidden rounded-full bg-alpha-slate-8">
                          <div className="flex items-start self-stretch rounded-full bg-data-viz-categorical-01 w-[37%]" />
                        </div>
                      </div>
                    </Table.Cell>
                    <Table.Cell>
                      <div className="flex items-center gap-1">
                        <div className="flex h-2.5 w-2.5 flex-none items-start rounded-[3px] bg-error-500" />
                        <div className="flex h-2.5 w-2.5 flex-none items-start rounded-[3px] bg-warning-500" />
                        <div className="flex h-2.5 w-2.5 flex-none items-start rounded-[3px] bg-warning-500" />
                        <div className="flex h-2.5 w-2.5 flex-none items-start rounded-[3px] bg-warning-500" />
                        <div className="flex h-2.5 w-2.5 flex-none items-start rounded-[3px] bg-warning-500" />
                      </div>
                    </Table.Cell>
                    <Table.Cell>
                      <svg
                        className="text-body-2 font-body-2 text-data-viz-categorical-01"
                        width="1em"
                        height="1em"
                        viewBox="0 0 64 20"
                      >
                        <path
                          d="m2 17 12-2 12-1 12-4 12-2 12-3"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeOpacity="1"
                        />
                      </svg>
                    </Table.Cell>
                    <Table.Cell variant="right-aligned">
                      <FeatherChevronRight className="text-body-2 font-body-2 text-neutral-400" />
                    </Table.Cell>
                  </Table.Row>
                  <Table.Row clickable={true}>
                    <Table.Cell>
                      <span className="text-caption-mono font-caption-mono text-neutral-400">
                        04
                      </span>
                    </Table.Cell>
                    <Table.Cell className="py-3">
                      <div className="flex flex-col items-start gap-1.5 py-3">
                        <div className="flex items-center gap-2">
                          <span className="text-subtitle-2 font-subtitle-2 text-default-font">
                            Professional Services
                          </span>
                          <span className="text-caption-xs-mono font-caption-xs-mono text-neutral-500 rounded-[4px] bg-neutral-100 px-1">
                            L2
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-1">
                          <Badge variant="error" size="xs">
                            1 high flag
                          </Badge>
                          <Badge variant="neutral" size="xs">
                            rate card 14% over peers
                          </Badge>
                        </div>
                      </div>
                    </Table.Cell>
                    <Table.Cell variant="right-aligned">
                      <div className="flex flex-col items-end">
                        <span className="text-body-2-mono font-body-2-mono text-default-font">
                          $27.3M
                        </span>
                        <span className="text-caption-xs-mono font-caption-xs-mono text-subtext-color">
                          9.7%
                        </span>
                      </div>
                    </Table.Cell>
                    <Table.Cell>
                      <div className="flex flex-col items-start">
                        <div className="flex items-center gap-1.5">
                          <span className="text-body-2-mono font-body-2-mono text-default-font">
                            2.3
                          </span>
                          <span className="text-caption-xs-mono font-caption-xs-mono text-error-600">
                            -0.2
                          </span>
                        </div>
                        <span className="text-caption-xs-mono font-caption-xs-mono text-subtext-color">
                          peer 2.5
                        </span>
                      </div>
                    </Table.Cell>
                    <Table.Cell>
                      <div className="flex w-28 flex-none flex-col items-start gap-1.5">
                        <div className="flex w-full items-center gap-1.5">
                          <span className="text-body-2-mono font-body-2-mono text-default-font">
                            $2.9M
                          </span>
                          <span className="text-caption-xs-mono font-caption-xs-mono text-subtext-color">
                            10.6%
                          </span>
                        </div>
                        <div className="flex h-1 w-full flex-none items-start overflow-hidden rounded-full bg-alpha-slate-8">
                          <div className="flex items-start self-stretch rounded-full bg-data-viz-categorical-01 w-[42%]" />
                        </div>
                      </div>
                    </Table.Cell>
                    <Table.Cell>
                      <div className="flex items-center gap-1">
                        <div className="flex h-2.5 w-2.5 flex-none items-start rounded-[3px] bg-error-500" />
                        <div className="flex h-2.5 w-2.5 flex-none items-start rounded-[3px] bg-warning-500" />
                        <div className="flex h-2.5 w-2.5 flex-none items-start rounded-[3px] bg-warning-500" />
                      </div>
                    </Table.Cell>
                    <Table.Cell>
                      <svg
                        className="text-body-2 font-body-2 text-neutral-400"
                        width="1em"
                        height="1em"
                        viewBox="0 0 64 20"
                      >
                        <path
                          d="m2 11 12 1 12-1 12 1 12-1 12 1"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeOpacity="1"
                        />
                      </svg>
                    </Table.Cell>
                    <Table.Cell variant="right-aligned">
                      <FeatherChevronRight className="text-body-2 font-body-2 text-neutral-400" />
                    </Table.Cell>
                  </Table.Row>
                  <Table.Row clickable={true}>
                    <Table.Cell>
                      <span className="text-caption-mono font-caption-mono text-neutral-400">
                        05
                      </span>
                    </Table.Cell>
                    <Table.Cell className="py-3">
                      <div className="flex flex-col items-start gap-1.5 py-3">
                        <div className="flex items-center gap-2">
                          <span className="text-subtitle-2 font-subtitle-2 text-default-font">
                            MRO
                          </span>
                          <span className="text-caption-xs-mono font-caption-xs-mono text-neutral-500 rounded-[4px] bg-neutral-100 px-1">
                            L2
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-1">
                          <Badge variant="neutral" size="xs">
                            maturity in line with peers
                          </Badge>
                          <Badge variant="neutral" size="xs">
                            tail spend 31% off-contract
                          </Badge>
                        </div>
                      </div>
                    </Table.Cell>
                    <Table.Cell variant="right-aligned">
                      <div className="flex flex-col items-end">
                        <span className="text-body-2-mono font-body-2-mono text-default-font">
                          $14.9M
                        </span>
                        <span className="text-caption-xs-mono font-caption-xs-mono text-subtext-color">
                          5.3%
                        </span>
                      </div>
                    </Table.Cell>
                    <Table.Cell>
                      <div className="flex flex-col items-start">
                        <div className="flex items-center gap-1.5">
                          <span className="text-body-2-mono font-body-2-mono text-default-font">
                            2.2
                          </span>
                          <span className="text-caption-xs-mono font-caption-xs-mono text-error-600">
                            -0.1
                          </span>
                        </div>
                        <span className="text-caption-xs-mono font-caption-xs-mono text-subtext-color">
                          peer 2.3
                        </span>
                      </div>
                    </Table.Cell>
                    <Table.Cell>
                      <div className="flex w-28 flex-none flex-col items-start gap-1.5">
                        <div className="flex w-full items-center gap-1.5">
                          <span className="text-body-2-mono font-body-2-mono text-default-font">
                            $1.4M
                          </span>
                          <span className="text-caption-xs-mono font-caption-xs-mono text-subtext-color">
                            9.4%
                          </span>
                        </div>
                        <div className="flex h-1 w-full flex-none items-start overflow-hidden rounded-full bg-alpha-slate-8">
                          <div className="flex items-start self-stretch rounded-full bg-data-viz-categorical-01 w-[37%]" />
                        </div>
                      </div>
                    </Table.Cell>
                    <Table.Cell>
                      <div className="flex items-center gap-1">
                        <div className="flex h-2.5 w-2.5 flex-none items-start rounded-[3px] bg-warning-500" />
                        <div className="flex h-2.5 w-2.5 flex-none items-start rounded-[3px] bg-warning-500" />
                        <div className="flex h-2.5 w-2.5 flex-none items-start rounded-[3px] bg-warning-500" />
                      </div>
                    </Table.Cell>
                    <Table.Cell>
                      <svg
                        className="text-body-2 font-body-2 text-neutral-400"
                        width="1em"
                        height="1em"
                        viewBox="0 0 64 20"
                      >
                        <path
                          d="m2 12 12-1 12 1h12l12-1 12 1"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeOpacity="1"
                        />
                      </svg>
                    </Table.Cell>
                    <Table.Cell variant="right-aligned">
                      <FeatherChevronRight className="text-body-2 font-body-2 text-neutral-400" />
                    </Table.Cell>
                  </Table.Row>
                  <Table.Row clickable={true}>
                    <Table.Cell>
                      <span className="text-caption-mono font-caption-mono text-neutral-400">
                        06
                      </span>
                    </Table.Cell>
                    <Table.Cell className="py-3">
                      <div className="flex flex-col items-start gap-1.5 py-3">
                        <div className="flex items-center gap-2">
                          <span className="text-subtitle-2 font-subtitle-2 text-default-font">
                            Grains &amp; Cereals
                          </span>
                          <span className="text-caption-xs-mono font-caption-xs-mono text-neutral-500 rounded-[4px] bg-neutral-100 px-1">
                            L2
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-1">
                          <Badge variant="success" size="xs">
                            ahead on maturity +0.3
                          </Badge>
                          <Badge variant="neutral" size="xs">
                            largest category
                          </Badge>
                        </div>
                      </div>
                    </Table.Cell>
                    <Table.Cell variant="right-aligned">
                      <div className="flex flex-col items-end">
                        <span className="text-body-2-mono font-body-2-mono text-default-font">
                          $91.6M
                        </span>
                        <span className="text-caption-xs-mono font-caption-xs-mono text-subtext-color">
                          32.7%
                        </span>
                      </div>
                    </Table.Cell>
                    <Table.Cell>
                      <div className="flex flex-col items-start">
                        <div className="flex items-center gap-1.5">
                          <span className="text-body-2-mono font-body-2-mono text-default-font">
                            2.9
                          </span>
                          <span className="text-caption-xs-mono font-caption-xs-mono text-success-600">
                            +0.3
                          </span>
                        </div>
                        <span className="text-caption-xs-mono font-caption-xs-mono text-subtext-color">
                          peer 2.6
                        </span>
                      </div>
                    </Table.Cell>
                    <Table.Cell>
                      <div className="flex w-28 flex-none flex-col items-start gap-1.5">
                        <div className="flex w-full items-center gap-1.5">
                          <span className="text-body-2-mono font-body-2-mono text-default-font">
                            $3.2M
                          </span>
                          <span className="text-caption-xs-mono font-caption-xs-mono text-subtext-color">
                            3.5%
                          </span>
                        </div>
                        <div className="flex h-1 w-full flex-none items-start overflow-hidden rounded-full bg-alpha-slate-8">
                          <div className="flex items-start self-stretch rounded-full bg-data-viz-categorical-01 w-[14%]" />
                        </div>
                      </div>
                    </Table.Cell>
                    <Table.Cell>
                      <div className="flex items-center gap-1">
                        <div className="flex h-2.5 w-2.5 flex-none items-start rounded-[3px] bg-warning-500" />
                        <div className="flex h-2.5 w-2.5 flex-none items-start rounded-[3px] bg-warning-500" />
                      </div>
                    </Table.Cell>
                    <Table.Cell>
                      <svg
                        className="text-body-2 font-body-2 text-success-600"
                        width="1em"
                        height="1em"
                        viewBox="0 0 64 20"
                      >
                        <path
                          d="m2 16 12-2 12-1 12-3 12-2 12-2"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeOpacity="1"
                        />
                      </svg>
                    </Table.Cell>
                    <Table.Cell variant="right-aligned">
                      <FeatherChevronRight className="text-body-2 font-body-2 text-neutral-400" />
                    </Table.Cell>
                  </Table.Row>
                </Table>
              </div>
              <div className="flex w-full flex-wrap items-center gap-4 border-t border-solid border-neutral-border px-6 py-3">
                <div className="flex items-center gap-1.5">
                  <div className="flex h-1 w-3 flex-none items-start rounded-full bg-data-viz-categorical-01" />
                  <span className="text-caption-xs font-caption-xs text-subtext-color">
                    Identified opportunities
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="flex h-2 w-2 flex-none items-start rounded-full border border-solid border-neutral-400" />
                  <span className="text-caption-xs font-caption-xs text-subtext-color">
                    Maturity gap to peer median
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="flex h-px w-3 flex-none items-start border-t border-dashed border-neutral-500" />
                  <span className="text-caption-xs font-caption-xs text-subtext-color">
                    Portfolio average 70
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="flex h-2 w-2 flex-none items-start rounded-[2px] bg-error-500" />
                  <span className="text-caption-xs font-caption-xs text-subtext-color">
                    High
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="flex h-2 w-2 flex-none items-start rounded-[2px] bg-warning-500" />
                  <span className="text-caption-xs font-caption-xs text-subtext-color">
                    Medium
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="flex h-2 w-2 flex-none items-start rounded-[2px] bg-neutral-300" />
                  <span className="text-caption-xs font-caption-xs text-subtext-color">
                    Low
                  </span>
                </div>
              </div>
            </div>
          </div>
          <div className="flex w-full flex-col items-start gap-3">
            <div className="flex w-full items-center gap-2">
              <FeatherSparkles className="text-caption font-caption text-brand-600" />
              <span className="whitespace-nowrap text-caption font-caption text-brand-600">
                Ask Anything about your portfolio
              </span>
              <div className="flex h-px grow shrink-0 basis-0 items-start border-t border-dotted border-brand-300" />
            </div>
            <div className="flex items-center gap-3 rounded-rounded-sm border border-dashed border-brand-300 bg-default-background px-3 py-2 mobile:w-full mobile:flex-none mobile:flex-col mobile:items-start">
              <span className="text-overline-xs-mono font-overline-xs-mono text-subtext-color uppercase">
                Suggestions
              </span>
              <Button
                variant="brand-subtle"
                size="xsmall"
                iconRight={<FeatherChevronDown />}
                onClick={(event: React.MouseEvent<HTMLButtonElement>) => {}}
              >
                Prompt suggestion 01
              </Button>
              <Button
                variant="brand-subtle"
                size="xsmall"
                iconRight={<FeatherChevronDown />}
                onClick={(event: React.MouseEvent<HTMLButtonElement>) => {}}
              >
                Prompt suggestion 02
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default PortfolioHealthFigmaRebuild;
