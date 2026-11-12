import { HugeiconsIcon } from "@hugeicons/react";
import {
  Download04Icon,
  Note01Icon,
  SearchIcon,
  Home01Icon,
  Tick02Icon,
  TickDouble02Icon,
  ArrowLeft02Icon,
  ArrowRight02Icon,
  Loading03Icon,
  Mail01Icon,
  CloudCheckIcon,
  CloudAlertIcon,
  Task01Icon,
  Logout01Icon,
  MoreHorizontalIcon,
  PencilEdit02Icon,
  Add01Icon,
  RefreshIcon,
  Delete02Icon,
  Share08Icon,
  SidebarLeft01Icon,
  UserCircleIcon,
  Settings01Icon,
  UnfoldMoreIcon,
  Sun03Icon,
  Moon02Icon,
  ComputerIcon,
  PaintBoardIcon,
  UserAdd01Icon,
  UserGroupIcon,
  KanbanIcon,
  Attachment01Icon,
  Folder01Icon,
  UserIcon,
  LeftToRightListBulletIcon,
  Cancel01Icon,
  Layers01Icon,
} from "@hugeicons/core-free-icons";
import type { ComponentProps } from "react";

type Props = Omit<ComponentProps<typeof HugeiconsIcon>, "icon">;
function appIcon(icon: ComponentProps<typeof HugeiconsIcon>["icon"]) {
  return function AppIcon({ strokeWidth = 2, ...props }: Props) {
    return <HugeiconsIcon icon={icon} strokeWidth={strokeWidth} {...props} />;
  };
}
export const Check = appIcon(Tick02Icon);
export const CheckCheck = appIcon(TickDouble02Icon);
export const ArrowLeft = appIcon(ArrowLeft02Icon);
export const ArrowRight = appIcon(ArrowRight02Icon);
export const LoaderCircle = appIcon(Loading03Icon);
export const Mail = appIcon(Mail01Icon);
export const CloudCheck = appIcon(CloudCheckIcon);
export const CloudOff = appIcon(CloudAlertIcon);
export const ListTodo = appIcon(Task01Icon);
export const LogOut = appIcon(Logout01Icon);
export const MoreHorizontal = appIcon(MoreHorizontalIcon);
export const Pencil = appIcon(PencilEdit02Icon);
export const Plus = appIcon(Add01Icon);
export const RefreshCw = appIcon(RefreshIcon);
export const Trash2 = appIcon(Delete02Icon);
export const Share = appIcon(Share08Icon);
export const SidebarToggle = appIcon(SidebarLeft01Icon);

export const UserCircle = appIcon(UserCircleIcon);


export const Home = appIcon(Home01Icon);

export const Search = appIcon(SearchIcon);

export const Note = appIcon(Note01Icon);

export const Download = appIcon(Download04Icon);

export const Settings = appIcon(Settings01Icon);
export const ChevronsUpDown = appIcon(UnfoldMoreIcon);
export const UserAdd = appIcon(UserAdd01Icon);
export const Users = appIcon(UserGroupIcon);
export const Sun = appIcon(Sun03Icon);
export const Moon = appIcon(Moon02Icon);
export const Monitor = appIcon(ComputerIcon);
export const Palette = appIcon(PaintBoardIcon);
export const Kanban = appIcon(KanbanIcon);
export const Paperclip = appIcon(Attachment01Icon);
export const Folder = appIcon(Folder01Icon);
export const User = appIcon(UserIcon);
export const ListView = appIcon(LeftToRightListBulletIcon);
export const X = appIcon(Cancel01Icon);
export const Layers = appIcon(Layers01Icon);
