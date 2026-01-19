import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useTheme } from '@/contexts/ThemeContext';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuLabel, 
  DropdownMenuSeparator, 
  DropdownMenuTrigger 
} from '@/components/ui/dropdown-menu';
import { User, LogOut, Settings, Moon, Sun } from 'lucide-react';

const UserProfile = () => {
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const [showDetails, setShowDetails] = useState(false);

  if (!user) return null;

  // ✅ Safe initials generation
  const getInitials = () => {
    const first = user.firstName?.charAt(0)?.toUpperCase() || '';
    const last = user.lastName?.charAt(0)?.toUpperCase() || '';
    return first + last || 'U';
  };

  const initials = getInitials();

  // ✅ FIX: Logout handler now properly calls AuthContext logout
  const handleLogout = () => {
    console.log('[USER_PROFILE] Logout initiated');
    logout(); // This will clear localStorage and navigate to home
  };

  // ✅ Navigate to Settings page
  const handleSettingsClick = () => {
    navigate('/settings');
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button 
            variant="ghost" 
            className="relative h-10 w-10 rounded-full bg-brand-100 hover:bg-brand-200 transition-colors"
          >
            <div className="flex items-center justify-center w-full h-full text-brand-700 font-semibold text-sm">
              {initials}
            </div>
          </Button>
        </DropdownMenuTrigger>
        
        <DropdownMenuContent className="w-56 glass-elevated" align="end">
          <DropdownMenuLabel>
            <div className="flex flex-col space-y-1">
              <p className="text-sm font-medium">
                {user.firstName || 'User'} {user.lastName || ''}
              </p>
              <p className="text-xs text-muted-foreground">{user.email || 'N/A'}</p>
            </div>
          </DropdownMenuLabel>
          
          <DropdownMenuSeparator />
          
          <DropdownMenuItem onClick={() => setShowDetails(true)}>
            <User className="mr-2 h-4 w-4" />
            View Profile
          </DropdownMenuItem>
          
          <DropdownMenuItem onClick={toggleTheme}>
            {theme === 'light' ? (
              <>
                <Moon className="mr-2 h-4 w-4" />
                Dark Mode
              </>
            ) : (
              <>
                <Sun className="mr-2 h-4 w-4" />
                Light Mode
              </>
            )}
          </DropdownMenuItem>
          
          <DropdownMenuItem onClick={handleSettingsClick}>
            <Settings className="mr-2 h-4 w-4" />
            Settings
          </DropdownMenuItem>
          
          <DropdownMenuSeparator />
          
          <DropdownMenuItem 
            onClick={handleLogout}
            className="text-destructive focus:text-destructive"
          >
            <LogOut className="mr-2 h-4 w-4" />
            Sign Out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Profile Details Modal/Card */}
      {showDetails && (
        <div 
          className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={() => setShowDetails(false)}
        >
          <Card 
            className="w-full max-w-md p-6 glass-elevated animate-in"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-center mb-6">
              <div className="w-16 h-16 rounded-full bg-brand-100 flex items-center justify-center mx-auto mb-4">
                <span className="text-2xl font-bold text-brand-700">{initials}</span>
              </div>
              <h3 className="text-title">
                {user.firstName || 'User'} {user.lastName || ''}
              </h3>
              <p className="text-caption">@{user.username || 'user'}</p>
            </div>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-caption">First Name</Label>
                  <p className="text-body font-medium">{user.firstName || 'N/A'}</p>
                </div>
                <div>
                  <Label className="text-caption">Last Name</Label>
                  <p className="text-body font-medium">{user.lastName || 'N/A'}</p>
                </div>
              </div>

              <div>
                <Label className="text-caption">Email</Label>
                <p className="text-body font-medium">{user.email || 'N/A'}</p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-caption">Contact</Label>
                  <p className="text-body font-medium">{user.phone || 'N/A'}</p>
                </div>
                <div>
                  <Label className="text-caption">Gender</Label>
                  <p className="text-body font-medium">{user.gender || 'N/A'}</p>
                </div>
              </div>
            </div>

            <div className="mt-6 pt-4 border-t border-border">
              <Button 
                variant="outline" 
                className="w-full"
                onClick={() => setShowDetails(false)}
              >
                Close
              </Button>
            </div>
          </Card>
        </div>
      )}
    </>
  );
};

export default UserProfile;