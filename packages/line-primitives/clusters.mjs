// Line primitives (roadmap item 1): the clusters the surveyed components fall into. A cluster is one canonical
// primitive's worth of components across libraries ("Modal", "Dialog" and "AlertDialog" are one cluster), named by
// the WAI-ARIA Authoring Practices pattern it follows where there is one. The survey assigns each surveyed component
// to the first cluster whose `names` matches its exported name; the coverage metric maps held-out components the
// same way. Pure data.

/**
 * @typedef {{ id: string, role: string|null, apg: string|null, names: RegExp, what: string }} Cluster
 */

const APG = 'https://www.w3.org/WAI/ARIA/apg/patterns/';

/** @type {readonly Cluster[]} Ordered: the first match wins, so the narrower patterns come first. */
export const CLUSTERS = Object.freeze([
  { id: 'iconButton', role: 'button', apg: `${APG}button/`, names: /^(IconButton|ActionIcon|CloseButton|Fab|IconButtonGroup)$/, what: 'A button that shows only an icon and carries its name in aria-label.' },
  { id: 'toggle', role: 'button', apg: `${APG}button/`, names: /^(Toggle|ToggleButton|ToggleGroup|ToggleButtonGroup|ToggleButtonGroupContext)$/, what: 'A button that stays pressed (aria-pressed), alone or in a group.' },
  { id: 'button', role: 'button', apg: `${APG}button/`, names: /^(Button|ButtonBase|UnstyledButton|LoadingButton|ActionButton|ButtonGroup|DownloadTrigger|CopyButton)$/, what: 'A control that runs an action when pressed.' },
  { id: 'link', role: 'link', apg: `${APG}link/`, names: /^(Link|Anchor|NavLink|LinkBox|LinkOverlay)$/, what: 'Navigates to another place.' },
  { id: 'numberField', role: 'spinbutton', apg: `${APG}spinbutton/`, names: /^(NumberInput|NumberField|NumberFormat)$/, what: 'A numeric input with step buttons.' },
  { id: 'pinInput', role: 'textbox', apg: null, names: /^(PinInput|InputOTP|OtpInput)$/, what: 'One box per character of a code.' },
  { id: 'textArea', role: 'textbox', apg: null, names: /^(TextArea|Textarea|TextareaAutosize|Autosize|JsonInput)$/, what: 'Multi-line text input.' },
  { id: 'combobox', role: 'combobox', apg: `${APG}combobox/`, names: /^(Combobox|ComboBox|Autocomplete|MultiSelect|TagsInput|Command)$/, what: 'A text input that filters a popup list of options.' },
  { id: 'select', role: 'combobox', apg: `${APG}combobox/`, names: /^(Select|NativeSelect|Listbox|ListBox|NativeSelectField)$/, what: 'Pick one option from a closed list.' },
  { id: 'textField', role: 'textbox', apg: null, names: /^(TextField|Input|TextInput|InputBase|OutlinedInput|FilledInput|InputGroup|InputAddon|PasswordInput|SearchField|Editable|ColorInput)$/, what: 'Single-line text input with a label.' },
  { id: 'checkbox', role: 'checkbox', apg: `${APG}checkbox/`, names: /^(Checkbox|CheckboxGroup|CheckboxCard|CheckboxIndicator)$/, what: 'A two- or three-state check.' },
  { id: 'radio', role: 'radiogroup', apg: `${APG}radio/`, names: /^(Radio|RadioGroup|RadioCard|RadioCardGroup|RadioIndicator|SegmentGroup|SegmentedControl)$/, what: 'Pick exactly one of a small set of visible options.' },
  { id: 'switch', role: 'switch', apg: `${APG}switch/`, names: /^(Switch|SwitchGroup)$/, what: 'An on/off setting that applies at once.' },
  { id: 'slider', role: 'slider', apg: `${APG}slider/`, names: /^(Slider|RangeSlider|AngleSlider)$/, what: 'Pick a number (or a range) by dragging a thumb.' },
  { id: 'timeField', role: 'group', apg: null, names: /^(TimeField|TimeInput|TimePicker|TimeGrid)$/, what: 'Enter a time of day.' },
  { id: 'datePicker', role: 'grid', apg: `${APG}dialog-modal/examples/datepicker-dialog/`, names: /^(DatePicker|DateInput|DateField|Calendar|RangeCalendar|DateRangePicker|DatePickerInput|DateTimePicker|MiniCalendar|MonthPicker|YearPicker|MonthPickerInput|YearPickerInput|DatesProvider)$/, what: 'Pick a date from a calendar grid.' },
  { id: 'drawer', role: 'dialog', apg: `${APG}dialog-modal/`, names: /^(Drawer|Sheet|SwipeableDrawer)$/, what: 'A dialog that slides in from an edge.' },
  { id: 'dialog', role: 'dialog', apg: `${APG}dialog-modal/`, names: /^(Dialog|Modal|AlertDialog|ModalOverlay|ConfirmDialog|ModalBase)$/, what: 'A modal window over the page; focus stays inside until it closes.' },
  { id: 'tooltip', role: 'tooltip', apg: `${APG}tooltip/`, names: /^(Tooltip|ToggleTip|TooltipFloating|TooltipGroup)$/, what: 'A short description shown on hover or focus.' },
  { id: 'popover', role: 'dialog', apg: null, names: /^(Popover|HoverCard|Popper|Popup|FloatingPanel)$/, what: 'Non-modal floating content anchored to a trigger.' },
  { id: 'menu', role: 'menu', apg: `${APG}menu-button/`, names: /^(Menu|DropdownMenu|ContextMenu|Menubar|MenuButton|MenuTrigger|MenuList|Dropdown|MenuItem)$/, what: 'A list of actions opened from a button.' },
  { id: 'tabs', role: 'tablist', apg: `${APG}tabs/`, names: /^(Tabs|Tab|TabList|TabGroup|TabPanels?|TabContext)$/, what: 'Switch between panels of content.' },
  { id: 'accordion', role: 'button', apg: `${APG}accordion/`, names: /^(Accordion|Collapsible|Disclosure|DisclosureGroup|ExpansionPanel)$/, what: 'Sections that expand and collapse.' },
  { id: 'toast', role: 'status', apg: `${APG}alert/`, names: /^(Toast|Toaster|Snackbar|SnackbarContent|Sonner|Notification|Notifications)$/, what: 'A short, temporary message about an event.' },
  { id: 'alert', role: 'alert', apg: `${APG}alert/`, names: /^(Alert|Callout|Banner|InlineAlert|AlertTitle)$/, what: 'An inline message that draws attention.' },
  { id: 'badge', role: null, apg: null, names: /^(Badge|Indicator|Status|StatusBadge)$/, what: 'A small label for a count or a status.' },
  { id: 'avatar', role: 'img', apg: null, names: /^(Avatar|AvatarGroup)$/, what: 'A person or entity picture with an initials fallback.' },
  { id: 'card', role: null, apg: null, names: /^(Card|Paper|CardSection)$/, what: 'A framed group of related content.' },
  { id: 'table', role: 'table', apg: `${APG}table/`, names: /^(Table|DataTable|TableContainer|DataGrid|Cell|Row|Column)$/, what: 'Rows and columns of data.' },
  { id: 'pagination', role: 'navigation', apg: null, names: /^(Pagination|TablePagination)$/, what: 'Move between pages of results.' },
  { id: 'breadcrumbs', role: 'navigation', apg: `${APG}breadcrumb/`, names: /^(Breadcrumbs?)$/, what: 'The path to the current page.' },
  { id: 'progress', role: 'progressbar', apg: null, names: /^(Progress|ProgressBar|LinearProgress|CircularProgress|RingProgress|ProgressCircle|Meter|SemiCircleProgress)$/, what: 'How far a task has got.' },
  { id: 'spinner', role: 'status', apg: null, names: /^(Spinner|Loader|LoadingOverlay)$/, what: 'Something is loading; no amount known.' },
  { id: 'skeleton', role: null, apg: null, names: /^(Skeleton|SkeletonText|SkeletonCircle)$/, what: 'A placeholder shaped like the content that is loading.' },
  { id: 'emptyState', role: null, apg: null, names: /^(Empty|EmptyState)$/, what: 'What to show when there is nothing yet, with the next action.' },
  { id: 'form', role: 'form', apg: null, names: /^(Form)$/, what: 'A set of fields submitted together.' },
  { id: 'field', role: 'group', apg: null, names: /^(Field|FormControl|FormField|FormLabel|Fieldset|FormHelperText|InputLabel|Label|FieldError|InputWrapper|FormGroup|FieldLabel|Description|FormControlLabel|Legend)$/, what: 'A label, a control, help text and an error, wired together.' },
  { id: 'stepper', role: 'list', apg: null, names: /^(Stepper|Steps|Step|MobileStepper)$/, what: 'Where the user is in a multi-step flow.' },
  { id: 'fileUpload', role: 'button', apg: null, names: /^(FileUpload|FileTrigger|DropZone|Dropzone|FileButton|FileInput)$/, what: 'Pick or drop files.' },
  { id: 'tag', role: null, apg: null, names: /^(Tag|Chip|TagGroup|Pill|PillGroup|TagList)$/, what: 'A small removable or selectable token.' },
  { id: 'divider', role: 'separator', apg: null, names: /^(Divider|Separator)$/, what: 'A line between groups of content.' },
  { id: 'grid', role: null, apg: null, names: /^(Grid|SimpleGrid|GridItem|Grid2|Masonry|ImageList)$/, what: 'A two-dimensional layout.' },
  { id: 'stack', role: null, apg: null, names: /^(Stack|HStack|VStack|Flex|Group|Center|Container|Space|Wrap|AbsoluteCenter|Spacer|Box|AppShell|Bleed|Float|Square|Circle)$/, what: 'A one-dimensional layout with gaps.' },
  // Clusters seen in the survey that the core set does not build yet; they are what coverage reports as unmapped.
  { id: 'tree', role: 'tree', apg: `${APG}treeview/`, names: /^(Tree|TreeView|TreeItem|SimpleTreeView|RichTreeView)$/, what: 'A hierarchy you can expand.' },
  { id: 'carousel', role: 'region', apg: `${APG}carousel/`, names: /^(Carousel)$/, what: 'Slides shown one at a time.' },
  { id: 'colorPicker', role: 'group', apg: null, names: /^(Color\w*|HueSlider|AlphaSlider)$/, what: 'Pick a colour.' },
  { id: 'rating', role: 'radiogroup', apg: null, names: /^(Rating|RatingGroup)$/, what: 'Pick a score from stars.' },
  { id: 'scrollArea', role: null, apg: null, names: /^(ScrollArea|ScrollAreaAutosize)$/, what: 'Custom scrollbars.' },
  { id: 'navigationMenu', role: 'navigation', apg: null, names: /^(NavigationMenu|NavigationRail|BottomNavigation|BottomNavigationAction|Navigation)$/, what: 'Site navigation with flyouts.' },
  { id: 'toolbar', role: 'toolbar', apg: `${APG}toolbar/`, names: /^(Toolbar|AppBar)$/, what: 'A row of controls.' },
  { id: 'list', role: 'list', apg: null, names: /^(List|ListItem|GridList|ListItemButton|ListItemText|ListItemIcon|ListItemAvatar|ListSubheader)$/, what: 'A list of items.' },
  { id: 'typography', role: null, apg: null, names: /^(Text|Heading|Title|Typography|Code|Blockquote|Highlight|Mark|Em|Kbd|Quote|Strong|Prose)$/, what: 'Text styles.' },
  { id: 'image', role: 'img', apg: null, names: /^(Image|BackgroundImage|AspectRatio|Icon|SvgIcon|QrCode)$/, what: 'Pictures and icons.' },
  { id: 'splitter', role: 'separator', apg: `${APG}windowsplitter/`, names: /^(Splitter|Resizable|ResizablePanel)$/, what: 'Panels with a draggable divider.' },
  { id: 'timeline', role: 'list', apg: null, names: /^(Timeline|TimelineItem)$/, what: 'Events in time order.' },
  { id: 'transition', role: null, apg: null, names: /^(Fade|Grow|Slide|Zoom|Transition|Collapse|Presence)$/, what: 'Animation wrappers.' },
  { id: 'utility', role: null, apg: null, names: /^(Portal|VisuallyHidden|FocusTrap|FocusScope|ClientOnly|Show|For|Environment\w*|LocaleProvider|ClickAwayListener|NoSsr|CssBaseline|ScopedCssBaseline|GlobalStyles|Slot|DirectionProvider|I18nProvider|RouterProvider|Theme|Highlight\w*|Format\w*|Download\w*|Clipboard\w*|Marquee|Affix|Overlay|Backdrop|Burger|Spotlight|Tour|Mention|Toc|TableOfContents|SignaturePad|Splitter\w*)$/, what: 'Plumbing that renders no widget of its own.' },
]);

/**
 * The cluster a component name falls into, or null.
 * @param {string} name An exported component name (top-level, not a part).
 * @returns {Cluster|null} The first matching cluster.
 */
export function clusterOf(name) {
  return CLUSTERS.find((c) => c.names.test(name)) ?? null;
}
