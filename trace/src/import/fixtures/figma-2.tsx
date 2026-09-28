"use client";

import React from "react";
import { Avatar } from "@/ui-v2/components/Avatar";
import { Badge } from "@/ui-v2/components/Badge";
import { Breadcrumbs } from "@/ui-v2/components/Breadcrumbs";
import { Button } from "@/ui-v2/components/Button";
import { IconButton } from "@/ui-v2/components/IconButton";
import { MaxStates } from "@/ui-v2/components/MaxStates";
import { PageLayoutTopBar } from "@/ui-v2/components/PageLayoutTopBar";
import { Progress } from "@/ui-v2/components/Progress";
import { SideNav } from "@/ui-v2/components/SideNav";
import { Table } from "@/ui-v2/components/Table";
import { TopbarWithRightNav } from "@/ui-v2/components/TopbarWithRightNav";
import LogoMax from "@/ui-v2/icons/LogoMax";
import { FeatherActivity } from "@subframe/core";
import { FeatherArrowUpRight } from "@subframe/core";
import { FeatherChevronDown } from "@subframe/core";
import { FeatherChevronRight } from "@subframe/core";
import { FeatherFileText } from "@subframe/core";
import { FeatherGauge } from "@subframe/core";
import { FeatherHome } from "@subframe/core";
import { FeatherLayers } from "@subframe/core";
import { FeatherListChecks } from "@subframe/core";
import { FeatherMessageCircle } from "@subframe/core";
import { FeatherSearch } from "@subframe/core";
import { FeatherShieldCheck } from "@subframe/core";
import { FeatherSparkles } from "@subframe/core";
import { FeatherTriangle } from "@subframe/core";

function PortfolioHealthFigmaRebuild2() {
  return (
    <div className="flex w-full flex-col items-start bg-neutral-50">
      <PageLayoutTopBar
        className="bg-neutral-50"
        header={
          <TopbarWithRightNav
            className="border-b border-solid border-alpha-slate-8 bg-alpha-white-80"
            leftSlot={
              <Breadcrumbs>
                <Breadcrumbs.Item icon={true} icon2={<FeatherGauge />}>
                  Health
                </Breadcrumbs.Item>
                <FeatherChevronRight className="text-body-2 font-body-2 text-subtext-color" />
                <Button
                  variant="brand-subtle"
                  size="small"
                  icon={<FeatherLayers />}
                  iconRight={<FeatherChevronDown />}
                  onClick={(event: React.MouseEvent<HTMLButtonElement>) => {}}
                >
                  My Portfolio
                </Button>
              </Breadcrumbs>
            }
            rightSlot={
              <>
                <IconButton
                  variant="ghost"
                  size="small"
                  icon={<FeatherSearch />}
                  onClick={(event: React.MouseEvent<HTMLButtonElement>) => {}}
                />
                <div className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-alpha-brand-8 shadow-elevation---01">
                  <MaxStates className="h-8 w-8 flex-none" />
                </div>
                <div className="flex h-10 items-center justify-center gap-2 rounded-rounded-sm border border-solid border-neutral-border bg-default-background px-3 shadow-xs">
                  <Avatar variant="brand" size="x-small" image="">
                    PN
                  </Avatar>
                  <span className="whitespace-nowrap text-button font-button text-neutral-700 mobile:hidden">
                    Prerna
                  </span>
                  <FeatherChevronDown className="text-body-2 font-body-2 text-subtext-color" />
                </div>
              </>
            }
          />
        }
        sideNav={
          <SideNav
            className="sticky top-0 self-start bg-neutral-50 mobile:hidden"
            header={
              <div className="flex h-10 w-10 flex-none items-center justify-center">
                <LogoMax className="text-h5 font-h5 text-default-font" />
              </div>
            }
            mainMenu={
              <>
                <SideNav.NavSection label="">
                  <SideNav.NavItem icon={<FeatherHome />} collapsed={true}>
                    Home
                  </SideNav.NavItem>
                  <SideNav.NavItem
                    icon={<FeatherListChecks />}
                    collapsed={true}
                  >
                    Actions
                  </SideNav.NavItem>
                </SideNav.NavSection>
                <SideNav.NavSection label="">
                  <SideNav.NavItem
                    icon={<FeatherShieldCheck />}
                    collapsed={true}
                  >
                    Opportunity
                  </SideNav.NavItem>
                  <SideNav.NavItem
                    className="bg-alpha-brand-12 shadow-none hover:bg-alpha-brand-16 [&_svg]:text-brand-600"
                    icon={<FeatherGauge />}
                    selected={true}
                    collapsed={true}
                  >
                    Health
                  </SideNav.NavItem>
                  <SideNav.NavItem icon={<FeatherActivity />} collapsed={true}>
                    Signal
                  </SideNav.NavItem>
                </SideNav.NavSection>
                <SideNav.NavSection label="">
                  <SideNav.NavItem
                    icon={<FeatherMessageCircle />}
                    collapsed={true}
                  >
                    Conversations
                  </SideNav.NavItem>
                  <SideNav.NavItem icon={<FeatherFileText />} collapsed={true}>
                    Artifacts
                  </SideNav.NavItem>
                  <SideNav.NavItem icon={<FeatherSparkles />} collapsed={true}>
                    My Max
                  </SideNav.NavItem>
                </SideNav.NavSection>
              </>
            }
            collapsed={true}
          />
        }
      >
        <div className="flex w-full max-w-[960px] flex-col items-start gap-10 px-4 pt-6 pb-32 mobile:gap-8 mobile:px-0">
          <div className="flex w-full flex-col items-start gap-5">
            <div className="flex w-full flex-wrap items-start gap-10 mobile:gap-6">
              <div className="flex flex-col items-start gap-1">
                <span className="whitespace-nowrap text-overline-xs-mono font-overline-xs-mono text-subtext-color uppercase">
                  Your categories
                </span>
                <span className="text-body-2-mono font-body-2-mono text-default-font">
                  6
                </span>
              </div>
              <div className="flex flex-col items-start gap-1">
                <span className="whitespace-nowrap text-overline-xs-mono font-overline-xs-mono text-subtext-color uppercase">
                  Spend you manage
                </span>
                <span className="text-body-2-mono font-body-2-mono text-default-font">
                  $280.2M
                </span>
              </div>
              <div className="flex flex-col items-start gap-1">
                <span className="whitespace-nowrap text-overline-xs-mono font-overline-xs-mono text-subtext-color uppercase">
                  Refreshed
                </span>
                <span className="text-body-2-mono font-body-2-mono text-default-font">
                  31 Jul 2026
                </span>
              </div>
            </div>
            <div className="flex h-px w-full flex-none items-start bg-neutral-border" />
          </div>
          <div className="flex w-full flex-col items-start gap-6">
            <div className="flex w-full items-center gap-3">
              <div className="flex h-2 w-2 flex-none items-start rounded-full bg-brand-500" />
              <span className="whitespace-nowrap text-overline-xs-mono font-overline-xs-mono text-brand-600 uppercase">
                Max · your portfolio summary
              </span>
              <div className="flex h-px min-w-[0px] grow shrink-0 basis-0 items-start bg-alpha-brand-24" />
            </div>
            <span className="w-full text-h1-max font-h1-max text-default-font mobile:text-h4-max mobile:font-h4-max tablet:text-h2-max tablet:font-h2-max">
              Grains is carrying your portfolio. Logistics and Packaging are
              not.
            </span>
            <div className="flex w-full max-w-[760px] flex-col items-start gap-4">
              <span className="text-body-1 font-body-1 text-neutral-700">
                Improving: Grains, up on contract coverage and a renegotiated
                origination mix, and Chemicals, where the solvent index fell two
                quarters running.
              </span>
              <span className="text-body-1 font-body-1 text-neutral-700">
                Declining: Logistics, where the maturity gap widened to −0.7 and
                three high flags are open, and Packaging, where supplier
                concentration moved the wrong way. IT &amp; Software is flat.
                There is no single portfolio score here on purpose — averaging
                six categories produces a number that means nothing.
              </span>
            </div>
          </div>
          <div className="flex w-full flex-col items-start gap-5">
            <div className="flex w-full items-center gap-4">
              <span className="whitespace-nowrap text-h5 font-h5 text-default-font">
                Your portfolio at a glance
              </span>
              <div className="flex h-px min-w-[0px] grow shrink-0 basis-0 items-start bg-neutral-border" />
            </div>
            <div className="flex w-full flex-col items-start overflow-hidden rounded-rounded-lg border border-solid border-neutral-border bg-default-background">
              <div className="flex w-full items-stretch mobile:flex-col">
                <div className="flex grow shrink-0 basis-0 flex-col items-start gap-3 bg-neutral-100 px-6 py-6">
                  <span className="text-overline-xs-mono font-overline-xs-mono text-subtext-color uppercase">
                    Spend you manage · T12M
                  </span>
                  <span className="text-h2-max font-h2-max text-default-font">
                    $280M
                  </span>
                  <div className="flex items-center gap-1">
                    <FeatherTriangle className="text-caption font-caption text-success-600" />
                    <span className="text-caption-mono font-caption-mono text-success-700">
                      8.4% YoY
                    </span>
                  </div>
                  <span className="text-body-2 font-body-2 text-neutral-600">
                    Across the six categories assigned to you. Grains &amp;
                    Cereals is 33% of it.
                  </span>
                </div>
                <div className="flex w-px flex-none items-start self-stretch bg-neutral-border mobile:h-px mobile:w-full mobile:flex-none" />
                <div className="flex grow shrink-0 basis-0 flex-col items-start gap-3 px-6 py-6">
                  <span className="text-overline-xs-mono font-overline-xs-mono text-subtext-color uppercase">
                    Savings potential
                  </span>
                  <span className="text-h2-max font-h2-max text-default-font">
                    $24.5M
                  </span>
                  <span className="text-caption-mono font-caption-mono text-success-700">
                    38% of qualified savings initiatives accepted
                  </span>
                  <span className="text-body-2 font-body-2 text-neutral-600">
                    Sum of the mid-point estimate from each of your six
                    categories. 23 of 60 qualified initiatives have been
                    accepted.
                  </span>
                </div>
              </div>
              <div className="flex h-px w-full flex-none items-start bg-neutral-border" />
              <div className="flex w-full items-stretch tablet:flex-col">
                <div className="flex grow shrink-0 basis-0 flex-col items-start gap-4 px-6 py-6">
                  <div className="flex w-full items-center justify-between">
                    <span className="text-overline-xs-mono font-overline-xs-mono text-subtext-color uppercase">
                      Resilience based initiatives
                    </span>
                    <FeatherArrowUpRight className="text-body-1 font-body-1 text-subtext-color" />
                  </div>
                  <span className="text-h3-max font-h3-max text-default-font">
                    21
                  </span>
                  <div className="items-start gap-1 grid grid-cols-11">
                    <div className="flex h-3.5 w-3.5 flex-none items-start rounded-[3px] bg-error-500" />
                    <div className="flex h-3.5 w-3.5 flex-none items-start rounded-[3px] bg-error-500" />
                    <div className="flex h-3.5 w-3.5 flex-none items-start rounded-[3px] bg-error-500" />
                    <div className="flex h-3.5 w-3.5 flex-none items-start rounded-[3px] bg-error-500" />
                    <div className="flex h-3.5 w-3.5 flex-none items-start rounded-[3px] bg-error-500" />
                    <div className="flex h-3.5 w-3.5 flex-none items-start rounded-[3px] bg-error-500" />
                    <div className="flex h-3.5 w-3.5 flex-none items-start rounded-[3px] bg-error-500" />
                    <div className="flex h-3.5 w-3.5 flex-none items-start rounded-[3px] bg-warning-500" />
                    <div className="flex h-3.5 w-3.5 flex-none items-start rounded-[3px] bg-warning-500" />
                    <div className="flex h-3.5 w-3.5 flex-none items-start rounded-[3px] bg-warning-500" />
                    <div className="flex h-3.5 w-3.5 flex-none items-start rounded-[3px] bg-warning-500" />
                    <div className="flex h-3.5 w-3.5 flex-none items-start rounded-[3px] bg-warning-500" />
                    <div className="flex h-3.5 w-3.5 flex-none items-start rounded-[3px] bg-warning-500" />
                    <div className="flex h-3.5 w-3.5 flex-none items-start rounded-[3px] bg-warning-500" />
                    <div className="flex h-3.5 w-3.5 flex-none items-start rounded-[3px] bg-warning-500" />
                    <div className="flex h-3.5 w-3.5 flex-none items-start rounded-[3px] bg-warning-500" />
                    <div className="flex h-3.5 w-3.5 flex-none items-start rounded-[3px] bg-warning-500" />
                    <div className="flex h-3.5 w-3.5 flex-none items-start rounded-[3px] bg-warning-500" />
                    <div className="flex h-3.5 w-3.5 flex-none items-start rounded-[3px] bg-warning-500" />
                    <div className="flex h-3.5 w-3.5 flex-none items-start rounded-[3px] bg-warning-500" />
                    <div className="flex h-3.5 w-3.5 flex-none items-start rounded-[3px] bg-neutral-300" />
                  </div>
                  <div className="flex flex-col items-start gap-1">
                    <span className="text-caption-mono font-caption-mono text-neutral-700">
                      7 high · 13 medium · 1 low.
                    </span>
                    <span className="text-body-2 font-body-2 text-neutral-600">
                      4 categories carry at least one high.
                    </span>
                  </div>
                </div>
                <div className="flex w-px flex-none items-start self-stretch bg-neutral-border tablet:h-px tablet:w-full tablet:flex-none" />
                <div className="flex grow shrink-0 basis-0 flex-col items-start gap-4 px-6 py-6">
                  <div className="flex w-full items-center justify-between">
                    <span className="text-overline-xs-mono font-overline-xs-mono text-subtext-color uppercase">
                      Number of savings initiatives
                    </span>
                    <FeatherArrowUpRight className="text-body-1 font-body-1 text-subtext-color" />
                  </div>
                  <span className="text-h3-max font-h3-max text-default-font">
                    26
                  </span>
                  <div className="flex w-full flex-col items-start gap-1.5">
                    <div className="flex w-full items-center py-1 relative">
                      <div className="flex h-2 grow shrink-0 basis-0 gap-0.5 overflow-hidden rounded-full items-stretch">
                        <div className="flex items-start bg-error-500 w-[27%]" />
                        <div className="flex items-start bg-warning-500 w-[50%]" />
                        <div className="flex grow shrink-0 basis-0 items-start bg-neutral-300" />
                      </div>
                      <div className="flex h-4 w-0.5 flex-none items-start rounded-full bg-neutral-900 absolute left-[70%] top-0" />
                    </div>
                    <div className="flex w-full items-start justify-end pr-[26%]">
                      <span className="self-stretch whitespace-nowrap text-caption-xs-mono font-caption-xs-mono text-subtext-color">
                        target $42.0M
                      </span>
                    </div>
                  </div>
                  <span className="text-body-2 font-body-2 text-neutral-600">
                    Savings initiatives raised but not yet accepted by an owner.
                    Oldest has been waiting 34 days.
                  </span>
                </div>
                <div className="flex w-px flex-none items-start self-stretch bg-neutral-border tablet:h-px tablet:w-full tablet:flex-none" />
                <div className="flex grow shrink-0 basis-0 flex-col items-start gap-4 px-6 py-6">
                  <div className="flex w-full items-center justify-between">
                    <span className="text-overline-xs-mono font-overline-xs-mono text-subtext-color uppercase">
                      Risk initiatives
                    </span>
                    <FeatherArrowUpRight className="text-body-1 font-body-1 text-subtext-color" />
                  </div>
                  <div className="flex gap-2 items-baseline">
                    <span className="text-h3-max font-h3-max text-warning-600">
                      6
                    </span>
                    <span className="text-caption-mono font-caption-mono text-subtext-color">
                      resilience initiatives · 2 categories
                    </span>
                  </div>
                  <div className="flex w-full flex-col items-start gap-1.5">
                    <div className="flex w-full items-center py-1 relative">
                      <div className="flex h-2 grow shrink-0 basis-0 gap-0.5 overflow-hidden rounded-full items-stretch">
                        <div className="flex items-start bg-error-500 w-[33%]" />
                        <div className="flex items-start bg-warning-500 w-[34%]" />
                        <div className="flex grow shrink-0 basis-0 items-start bg-neutral-300" />
                      </div>
                      <div className="flex h-4 w-0.5 flex-none items-start rounded-full bg-neutral-900 absolute left-[80%] top-0" />
                    </div>
                    <div className="flex w-full items-start justify-end pr-[16%]">
                      <span className="self-stretch whitespace-nowrap text-caption-xs-mono font-caption-xs-mono text-subtext-color">
                        target 8
                      </span>
                    </div>
                  </div>
                  <span className="text-body-2 font-body-2 text-neutral-600">
                    Risk reduction awaiting a decision. Not measured in savings,
                    so it is counted separately.
                  </span>
                </div>
              </div>
            </div>
          </div>
          <div className="flex w-full flex-col items-start gap-4">
            <div className="flex w-full items-center gap-3">
              <FeatherSparkles className="text-body-1 font-body-1 text-brand-600" />
              <span className="whitespace-nowrap text-subtitle-1-max font-subtitle-1-max text-default-font">
                Ask Anything about your portfolio
              </span>
              <div className="flex h-px min-w-[0px] grow shrink-0 basis-0 items-start border-t border-dotted border-alpha-brand-32" />
            </div>
            <div className="flex w-full flex-col items-start gap-3 rounded-rounded-md border border-dashed border-brand-300 bg-default-background px-5 py-4">
              <span className="text-overline-xs-mono font-overline-xs-mono text-subtext-color uppercase">
                Suggestions
              </span>
              <div className="flex w-full flex-wrap items-center gap-2 mobile:flex-col mobile:flex-nowrap mobile:items-stretch">
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
          <div className="flex w-full flex-col items-start gap-5">
            <div className="flex w-full flex-col items-start gap-2">
              <div className="flex w-full items-center gap-4">
                <span className="whitespace-nowrap text-h5 font-h5 text-default-font">
                  Category overview
                </span>
                <div className="flex h-px min-w-[0px] grow shrink-0 basis-0 items-start bg-neutral-border" />
              </div>
              <span className="max-w-[760px] text-body-2 font-body-2 text-subtext-color">
                Order based on top spend categories (Top 10) within that ordered
                by the ones needing max attention. Open any row for the full
                scorecard.
              </span>
            </div>
            <div className="flex w-full flex-col items-start overflow-hidden rounded-rounded-lg border border-solid border-neutral-border bg-default-background">
              <div className="flex w-full flex-col items-start overflow-x-auto">
                <Table
                  header={
                    <Table.HeaderRow>
                      <Table.HeaderCell className="h-8 w-12 flex-none mobile:hidden">
                        #
                      </Table.HeaderCell>
                      <Table.HeaderCell>Category</Table.HeaderCell>
                      <Table.HeaderCell
                        className="h-8 w-24 flex-none mobile:hidden"
                        variant="right-aligned"
                      >
                        Spend
                      </Table.HeaderCell>
                      <Table.HeaderCell className="h-8 w-24 flex-none mobile:hidden">
                        Maturity
                      </Table.HeaderCell>
                      <Table.HeaderCell className="h-8 w-36 flex-none">
                        Savings potential
                      </Table.HeaderCell>
                      <Table.HeaderCell className="h-8 w-28 flex-none tablet:hidden">
                        Needs attention
                      </Table.HeaderCell>
                      <Table.HeaderCell className="h-8 w-20 flex-none tablet:hidden">
                        Trend
                      </Table.HeaderCell>
                      <Table.HeaderCell className="h-8 w-12 flex-none" />
                    </Table.HeaderRow>
                  }
                >
                  <Table.Row className="bg-error-50" clickable={true}>
                    <Table.Cell className="mobile:hidden">
                      <span className="text-caption-mono font-caption-mono text-subtext-color">
                        01
                      </span>
                    </Table.Cell>
                    <Table.Cell className="h-24 grow shrink-0 basis-0">
                      <div className="flex min-w-[0px] flex-col items-start gap-2 py-3">
                        <div className="flex items-center gap-2">
                          <span className="text-subtitle-1 font-subtitle-1 text-default-font">
                            Logistics
                          </span>
                          <Badge variant="neutral" size="xs">
                            L3
                          </Badge>
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Badge variant="error" size="xs">
                            3 high flags
                          </Badge>
                          <Badge variant="error" size="xs">
                            widest maturity gap −0.7
                          </Badge>
                          <Badge variant="error" size="xs">
                            $740K overdue 12d
                          </Badge>
                        </div>
                      </div>
                    </Table.Cell>
                    <Table.Cell
                      className="mobile:hidden"
                      variant="right-aligned"
                    >
                      <div className="flex flex-col items-end gap-0.5">
                        <span className="text-body-2-mono font-body-2-mono text-default-font">
                          $38.4M
                        </span>
                        <span className="text-caption-xs-mono font-caption-xs-mono text-subtext-color">
                          13.7%
                        </span>
                      </div>
                    </Table.Cell>
                    <Table.Cell className="mobile:hidden">
                      <div className="flex flex-col items-start gap-0.5">
                        <div className="flex gap-2 items-baseline">
                          <span className="text-body-2-mono font-body-2-mono text-default-font">
                            2.0
                          </span>
                          <span className="text-caption-mono font-caption-mono text-error-600">
                            −0.7
                          </span>
                        </div>
                        <span className="text-caption-xs-mono font-caption-xs-mono text-subtext-color">
                          peer 2.7
                        </span>
                      </div>
                    </Table.Cell>
                    <Table.Cell>
                      <div className="flex grow shrink-0 basis-0 flex-col items-start gap-2">
                        <div className="flex gap-2 items-baseline">
                          <span className="text-body-2-mono font-body-2-mono text-default-font">
                            $5.6M
                          </span>
                          <span className="text-caption-xs-mono font-caption-xs-mono text-subtext-color">
                            14.6%
                          </span>
                        </div>
                        <Progress
                          className="[&>div]:bg-data-viz-categorical-01"
                          value={41}
                          size="sm"
                        />
                      </div>
                    </Table.Cell>
                    <Table.Cell className="tablet:hidden">
                      <div className="flex items-center gap-1">
                        <div className="flex h-2.5 w-2.5 flex-none items-start rounded-[3px] bg-error-500" />
                        <div className="flex h-2.5 w-2.5 flex-none items-start rounded-[3px] bg-error-500" />
                        <div className="flex h-2.5 w-2.5 flex-none items-start rounded-[3px] bg-error-500" />
                        <div className="flex h-2.5 w-2.5 flex-none items-start rounded-[3px] bg-warning-500" />
                      </div>
                    </Table.Cell>
                    <Table.Cell className="tablet:hidden">
                      <svg
                        className="text-body-2 font-body-2 text-error-600 block h-6 w-full"
                        width="1em"
                        height="1em"
                        viewBox="0 0 100 24"
                      >
                        <path
                          d="m0 5 10 .5L20 5l10 2 10 1 10 .5L60 10l10 2 10 2 10 2 10 3"
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
                      <FeatherChevronRight className="text-h6 font-h6 text-subtext-color" />
                    </Table.Cell>
                  </Table.Row>
                  <Table.Row className="bg-error-50" clickable={true}>
                    <Table.Cell className="mobile:hidden">
                      <span className="text-caption-mono font-caption-mono text-subtext-color">
                        02
                      </span>
                    </Table.Cell>
                    <Table.Cell className="h-24 grow shrink-0 basis-0">
                      <div className="flex min-w-[0px] flex-col items-start gap-2 py-3">
                        <div className="flex items-center gap-2">
                          <span className="text-subtitle-1 font-subtitle-1 text-default-font">
                            Packaging
                          </span>
                          <Badge variant="neutral" size="xs">
                            L2
                          </Badge>
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Badge variant="neutral" size="xs">
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
                    <Table.Cell
                      className="mobile:hidden"
                      variant="right-aligned"
                    >
                      <div className="flex flex-col items-end gap-0.5">
                        <span className="text-body-2-mono font-body-2-mono text-default-font">
                          $62.8M
                        </span>
                        <span className="text-caption-xs-mono font-caption-xs-mono text-subtext-color">
                          22.4%
                        </span>
                      </div>
                    </Table.Cell>
                    <Table.Cell className="mobile:hidden">
                      <div className="flex flex-col items-start gap-0.5">
                        <div className="flex gap-2 items-baseline">
                          <span className="text-body-2-mono font-body-2-mono text-default-font">
                            1.8
                          </span>
                          <span className="text-caption-mono font-caption-mono text-error-600">
                            −0.6
                          </span>
                        </div>
                        <span className="text-caption-xs-mono font-caption-xs-mono text-subtext-color">
                          peer 2.4
                        </span>
                      </div>
                    </Table.Cell>
                    <Table.Cell>
                      <div className="flex grow shrink-0 basis-0 flex-col items-start gap-2">
                        <div className="flex gap-2 items-baseline">
                          <span className="text-body-2-mono font-body-2-mono text-default-font">
                            $7.1M
                          </span>
                          <span className="text-caption-xs-mono font-caption-xs-mono text-subtext-color">
                            11.3%
                          </span>
                        </div>
                        <Progress
                          className="[&>div]:bg-data-viz-categorical-01"
                          value={52}
                          size="sm"
                        />
                      </div>
                    </Table.Cell>
                    <Table.Cell className="tablet:hidden">
                      <div className="flex items-center gap-1">
                        <div className="flex h-2.5 w-2.5 flex-none items-start rounded-[3px] bg-error-500" />
                        <div className="flex h-2.5 w-2.5 flex-none items-start rounded-[3px] bg-error-500" />
                        <div className="flex h-2.5 w-2.5 flex-none items-start rounded-[3px] bg-warning-500" />
                        <div className="flex h-2.5 w-2.5 flex-none items-start rounded-[3px] bg-warning-500" />
                      </div>
                    </Table.Cell>
                    <Table.Cell className="tablet:hidden">
                      <svg
                        className="text-body-2 font-body-2 text-warning-600 block h-6 w-full"
                        width="1em"
                        height="1em"
                        viewBox="0 0 100 24"
                      >
                        <path
                          d="m0 12 10-1 10-.5 10 .5 10 .5 10 .5 10-.5 10 .7 10 .4 10 .2 10 .2"
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
                      <FeatherChevronRight className="text-h6 font-h6 text-subtext-color" />
                    </Table.Cell>
                  </Table.Row>
                  <Table.Row clickable={true}>
                    <Table.Cell className="mobile:hidden">
                      <span className="text-caption-mono font-caption-mono text-subtext-color">
                        03
                      </span>
                    </Table.Cell>
                    <Table.Cell className="h-24 grow shrink-0 basis-0">
                      <div className="flex min-w-[0px] flex-col items-start gap-2 py-3">
                        <div className="flex items-center gap-2">
                          <span className="text-subtitle-1 font-subtitle-1 text-default-font">
                            IT Services
                          </span>
                          <Badge variant="neutral" size="xs">
                            L3
                          </Badge>
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Badge variant="neutral" size="xs">
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
                    <Table.Cell
                      className="mobile:hidden"
                      variant="right-aligned"
                    >
                      <div className="flex flex-col items-end gap-0.5">
                        <span className="text-body-2-mono font-body-2-mono text-default-font">
                          $45.2M
                        </span>
                        <span className="text-caption-xs-mono font-caption-xs-mono text-subtext-color">
                          16.1%
                        </span>
                      </div>
                    </Table.Cell>
                    <Table.Cell className="mobile:hidden">
                      <div className="flex flex-col items-start gap-0.5">
                        <div className="flex gap-2 items-baseline">
                          <span className="text-body-2-mono font-body-2-mono text-default-font">
                            2.1
                          </span>
                          <span className="text-caption-mono font-caption-mono text-error-600">
                            −0.5
                          </span>
                        </div>
                        <span className="text-caption-xs-mono font-caption-xs-mono text-subtext-color">
                          peer 2.6
                        </span>
                      </div>
                    </Table.Cell>
                    <Table.Cell>
                      <div className="flex grow shrink-0 basis-0 flex-col items-start gap-2">
                        <div className="flex gap-2 items-baseline">
                          <span className="text-body-2-mono font-body-2-mono text-default-font">
                            $4.2M
                          </span>
                          <span className="text-caption-xs-mono font-caption-xs-mono text-subtext-color">
                            9.3%
                          </span>
                        </div>
                        <Progress
                          className="[&>div]:bg-data-viz-categorical-01"
                          value={84}
                          size="sm"
                        />
                      </div>
                    </Table.Cell>
                    <Table.Cell className="tablet:hidden">
                      <div className="flex items-center gap-1">
                        <div className="flex h-2.5 w-2.5 flex-none items-start rounded-[3px] bg-error-500" />
                        <div className="flex h-2.5 w-2.5 flex-none items-start rounded-[3px] bg-warning-500" />
                        <div className="flex h-2.5 w-2.5 flex-none items-start rounded-[3px] bg-warning-500" />
                        <div className="flex h-2.5 w-2.5 flex-none items-start rounded-[3px] bg-warning-500" />
                        <div className="flex h-2.5 w-2.5 flex-none items-start rounded-[3px] bg-neutral-300" />
                      </div>
                    </Table.Cell>
                    <Table.Cell className="tablet:hidden">
                      <svg
                        className="text-body-2 font-body-2 text-data-viz-categorical-01 block h-6 w-full"
                        width="1em"
                        height="1em"
                        viewBox="0 0 100 24"
                      >
                        <path
                          d="m0 17 10-.5 10-.5 10-.8 10-.7 10-.7 10-.5 10-1 10-1 10-1L100 9"
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
                      <FeatherChevronRight className="text-h6 font-h6 text-subtext-color" />
                    </Table.Cell>
                  </Table.Row>
                  <Table.Row clickable={true}>
                    <Table.Cell className="mobile:hidden">
                      <span className="text-caption-mono font-caption-mono text-subtext-color">
                        04
                      </span>
                    </Table.Cell>
                    <Table.Cell className="h-24 grow shrink-0 basis-0">
                      <div className="flex min-w-[0px] flex-col items-start gap-2 py-3">
                        <div className="flex items-center gap-2">
                          <span className="text-subtitle-1 font-subtitle-1 text-default-font">
                            Professional Services
                          </span>
                          <Badge variant="neutral" size="xs">
                            L2
                          </Badge>
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Badge variant="error" size="xs">
                            1 high flag
                          </Badge>
                          <Badge variant="neutral" size="xs">
                            rate card 14% over peers
                          </Badge>
                        </div>
                      </div>
                    </Table.Cell>
                    <Table.Cell
                      className="mobile:hidden"
                      variant="right-aligned"
                    >
                      <div className="flex flex-col items-end gap-0.5">
                        <span className="text-body-2-mono font-body-2-mono text-default-font">
                          $27.3M
                        </span>
                        <span className="text-caption-xs-mono font-caption-xs-mono text-subtext-color">
                          9.7%
                        </span>
                      </div>
                    </Table.Cell>
                    <Table.Cell className="mobile:hidden">
                      <div className="flex flex-col items-start gap-0.5">
                        <div className="flex gap-2 items-baseline">
                          <span className="text-body-2-mono font-body-2-mono text-default-font">
                            2.3
                          </span>
                          <span className="text-caption-mono font-caption-mono text-error-600">
                            −0.2
                          </span>
                        </div>
                        <span className="text-caption-xs-mono font-caption-xs-mono text-subtext-color">
                          peer 2.5
                        </span>
                      </div>
                    </Table.Cell>
                    <Table.Cell>
                      <div className="flex grow shrink-0 basis-0 flex-col items-start gap-2">
                        <div className="flex gap-2 items-baseline">
                          <span className="text-body-2-mono font-body-2-mono text-default-font">
                            $2.9M
                          </span>
                          <span className="text-caption-xs-mono font-caption-xs-mono text-subtext-color">
                            10.6%
                          </span>
                        </div>
                        <Progress
                          className="[&>div]:bg-data-viz-categorical-01"
                          value={59}
                          size="sm"
                        />
                      </div>
                    </Table.Cell>
                    <Table.Cell className="tablet:hidden">
                      <div className="flex items-center gap-1">
                        <div className="flex h-2.5 w-2.5 flex-none items-start rounded-[3px] bg-error-500" />
                        <div className="flex h-2.5 w-2.5 flex-none items-start rounded-[3px] bg-warning-500" />
                        <div className="flex h-2.5 w-2.5 flex-none items-start rounded-[3px] bg-warning-500" />
                      </div>
                    </Table.Cell>
                    <Table.Cell className="tablet:hidden">
                      <svg
                        className="text-body-2 font-body-2 text-neutral-400 block h-6 w-full"
                        width="1em"
                        height="1em"
                        viewBox="0 0 100 24"
                      >
                        <path
                          d="M0 12h10l10 .3 10-.3 10-.3 10 .3h10l10-.3 10 .3h10l10-.2"
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
                      <FeatherChevronRight className="text-h6 font-h6 text-subtext-color" />
                    </Table.Cell>
                  </Table.Row>
                  <Table.Row clickable={true}>
                    <Table.Cell className="mobile:hidden">
                      <span className="text-caption-mono font-caption-mono text-subtext-color">
                        05
                      </span>
                    </Table.Cell>
                    <Table.Cell className="h-24 grow shrink-0 basis-0">
                      <div className="flex min-w-[0px] flex-col items-start gap-2 py-3">
                        <div className="flex items-center gap-2">
                          <span className="text-subtitle-1 font-subtitle-1 text-default-font">
                            MRO
                          </span>
                          <Badge variant="neutral" size="xs">
                            L2
                          </Badge>
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Badge variant="neutral" size="xs">
                            maturity in line with peers
                          </Badge>
                          <Badge variant="neutral" size="xs">
                            tail spend 31% off-contract
                          </Badge>
                        </div>
                      </div>
                    </Table.Cell>
                    <Table.Cell
                      className="mobile:hidden"
                      variant="right-aligned"
                    >
                      <div className="flex flex-col items-end gap-0.5">
                        <span className="text-body-2-mono font-body-2-mono text-default-font">
                          $14.9M
                        </span>
                        <span className="text-caption-xs-mono font-caption-xs-mono text-subtext-color">
                          5.3%
                        </span>
                      </div>
                    </Table.Cell>
                    <Table.Cell className="mobile:hidden">
                      <div className="flex flex-col items-start gap-0.5">
                        <div className="flex gap-2 items-baseline">
                          <span className="text-body-2-mono font-body-2-mono text-default-font">
                            2.2
                          </span>
                          <span className="text-caption-mono font-caption-mono text-error-600">
                            −0.1
                          </span>
                        </div>
                        <span className="text-caption-xs-mono font-caption-xs-mono text-subtext-color">
                          peer 2.3
                        </span>
                      </div>
                    </Table.Cell>
                    <Table.Cell>
                      <div className="flex grow shrink-0 basis-0 flex-col items-start gap-2">
                        <div className="flex gap-2 items-baseline">
                          <span className="text-body-2-mono font-body-2-mono text-default-font">
                            $1.4M
                          </span>
                          <span className="text-caption-xs-mono font-caption-xs-mono text-subtext-color">
                            9.4%
                          </span>
                        </div>
                        <Progress
                          className="[&>div]:bg-data-viz-categorical-01"
                          value={71}
                          size="sm"
                        />
                      </div>
                    </Table.Cell>
                    <Table.Cell className="tablet:hidden">
                      <div className="flex items-center gap-1">
                        <div className="flex h-2.5 w-2.5 flex-none items-start rounded-[3px] bg-warning-500" />
                        <div className="flex h-2.5 w-2.5 flex-none items-start rounded-[3px] bg-warning-500" />
                        <div className="flex h-2.5 w-2.5 flex-none items-start rounded-[3px] bg-warning-500" />
                      </div>
                    </Table.Cell>
                    <Table.Cell className="tablet:hidden">
                      <svg
                        className="text-body-2 font-body-2 text-neutral-400 block h-6 w-full"
                        width="1em"
                        height="1em"
                        viewBox="0 0 100 24"
                      >
                        <path
                          d="M0 12h20l10-.3 10 .3h30l10-.3 10 .3h10"
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
                      <FeatherChevronRight className="text-h6 font-h6 text-subtext-color" />
                    </Table.Cell>
                  </Table.Row>
                  <Table.Row clickable={true}>
                    <Table.Cell className="mobile:hidden">
                      <span className="text-caption-mono font-caption-mono text-subtext-color">
                        06
                      </span>
                    </Table.Cell>
                    <Table.Cell className="h-24 grow shrink-0 basis-0">
                      <div className="flex min-w-[0px] flex-col items-start gap-2 py-3">
                        <div className="flex items-center gap-2">
                          <span className="text-subtitle-1 font-subtitle-1 text-default-font">
                            Grains &amp; Cereals
                          </span>
                          <Badge variant="neutral" size="xs">
                            L2
                          </Badge>
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Badge variant="success" size="xs">
                            ahead on maturity +0.3
                          </Badge>
                          <Badge variant="neutral" size="xs">
                            largest category
                          </Badge>
                        </div>
                      </div>
                    </Table.Cell>
                    <Table.Cell
                      className="mobile:hidden"
                      variant="right-aligned"
                    >
                      <div className="flex flex-col items-end gap-0.5">
                        <span className="text-body-2-mono font-body-2-mono text-default-font">
                          $91.6M
                        </span>
                        <span className="text-caption-xs-mono font-caption-xs-mono text-subtext-color">
                          32.7%
                        </span>
                      </div>
                    </Table.Cell>
                    <Table.Cell className="mobile:hidden">
                      <div className="flex flex-col items-start gap-0.5">
                        <div className="flex gap-2 items-baseline">
                          <span className="text-body-2-mono font-body-2-mono text-default-font">
                            2.9
                          </span>
                          <span className="text-caption-mono font-caption-mono text-success-600">
                            +0.3
                          </span>
                        </div>
                        <span className="text-caption-xs-mono font-caption-xs-mono text-subtext-color">
                          peer 2.6
                        </span>
                      </div>
                    </Table.Cell>
                    <Table.Cell>
                      <div className="flex grow shrink-0 basis-0 flex-col items-start gap-2">
                        <div className="flex gap-2 items-baseline">
                          <span className="text-body-2-mono font-body-2-mono text-default-font">
                            $3.2M
                          </span>
                          <span className="text-caption-xs-mono font-caption-xs-mono text-subtext-color">
                            3.5%
                          </span>
                        </div>
                        <Progress
                          className="[&>div]:bg-data-viz-categorical-01"
                          value={78}
                          size="sm"
                        />
                      </div>
                    </Table.Cell>
                    <Table.Cell className="tablet:hidden">
                      <div className="flex items-center gap-1">
                        <div className="flex h-2.5 w-2.5 flex-none items-start rounded-[3px] bg-warning-500" />
                        <div className="flex h-2.5 w-2.5 flex-none items-start rounded-[3px] bg-warning-500" />
                      </div>
                    </Table.Cell>
                    <Table.Cell className="tablet:hidden">
                      <svg
                        className="text-body-2 font-body-2 text-success-600 block h-6 w-full"
                        width="1em"
                        height="1em"
                        viewBox="0 0 100 24"
                      >
                        <path
                          d="m0 16 10-.4 10-.5 10-.2 10-1 10-.5 10-.2 10-1 10-.7 10-.7 10-1"
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
                      <FeatherChevronRight className="text-h6 font-h6 text-subtext-color" />
                    </Table.Cell>
                  </Table.Row>
                </Table>
              </div>
              <div className="flex w-full flex-wrap items-center px-6 py-4 gap-x-6 gap-y-2">
                <div className="flex items-center gap-2">
                  <div className="flex h-2 w-2 flex-none items-start rounded-full bg-data-viz-categorical-01" />
                  <span className="text-caption font-caption text-subtext-color">
                    Identified opportunities
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex h-2 w-2 flex-none items-start rounded-full bg-alpha-slate-12" />
                  <span className="text-caption font-caption text-subtext-color">
                    Maturity gap to peer median
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex h-3 w-px flex-none items-start bg-neutral-400" />
                  <span className="text-caption font-caption text-subtext-color">
                    Portfolio average 70
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex h-2 w-2 flex-none items-start rounded-full bg-error-500" />
                  <span className="text-caption font-caption text-subtext-color">
                    High
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex h-2 w-2 flex-none items-start rounded-full bg-warning-500" />
                  <span className="text-caption font-caption text-subtext-color">
                    Medium
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex h-2 w-2 flex-none items-start rounded-full bg-neutral-300" />
                  <span className="text-caption font-caption text-subtext-color">
                    Low
                  </span>
                </div>
              </div>
            </div>
          </div>
          <div className="flex w-full flex-col items-start gap-4">
            <div className="flex w-full items-center gap-3">
              <FeatherSparkles className="text-body-1 font-body-1 text-brand-600" />
              <span className="whitespace-nowrap text-subtitle-1-max font-subtitle-1-max text-default-font">
                Ask Anything about your portfolio
              </span>
              <div className="flex h-px min-w-[0px] grow shrink-0 basis-0 items-start border-t border-dotted border-alpha-brand-32" />
            </div>
            <div className="flex w-full flex-col items-start gap-3 rounded-rounded-md border border-dashed border-brand-300 bg-default-background px-5 py-4">
              <span className="text-overline-xs-mono font-overline-xs-mono text-subtext-color uppercase">
                Suggestions
              </span>
              <div className="flex w-full flex-wrap items-center gap-2 mobile:flex-col mobile:flex-nowrap mobile:items-stretch">
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
      </PageLayoutTopBar>
    </div>
  );
}

export default PortfolioHealthFigmaRebuild2;
