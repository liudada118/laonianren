import React from 'react';
import { Routes, Route } from 'react-router-dom';
import { ThemeProvider } from './contexts/ThemeContext';
import { AssessmentProvider } from './contexts/AssessmentContext';
import { ToastProvider } from './components/ui/Toast';
import DeviceAlertOverlay from './components/ui/DeviceAlertOverlay';

// Pages
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import AssessmentHistory from './pages/AssessmentHistory';
import HistoryReportView from './pages/HistoryReportView';
import HistoryComprehensiveView from './pages/HistoryComprehensiveView';
import NotFound from './pages/NotFound';
import UpdateNotification from './components/ui/UpdateNotification';
import VersionHistory from './components/ui/VersionHistory';

// Assessment Pages
import GripAssessment from './pages/assessment/GripAssessment';
import SitStandAssessment from './pages/assessment/SitStandAssessment';
import StandingAssessment from './pages/assessment/StandingAssessment';
import GaitAssessment from './pages/assessment/GaitAssessment';

function App() {
  return (
    <ThemeProvider defaultTheme="light">
      <AssessmentProvider>
        <ToastProvider>
          <UpdateNotification />
          <VersionHistory />
          <DeviceAlertOverlay />
          <Routes>
            <Route path="/" element={<Login />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/assessment/grip" element={<GripAssessment />} />
            <Route path="/assessment/sitstand" element={<SitStandAssessment />} />
            <Route path="/assessment/standing" element={<StandingAssessment />} />
            <Route path="/assessment/gait" element={<GaitAssessment />} />
            <Route path="/history" element={<AssessmentHistory />} />
            <Route path="/history/report" element={<HistoryReportView />} />
            <Route path="/history/comprehensive" element={<HistoryComprehensiveView />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </ToastProvider>
      </AssessmentProvider>
    </ThemeProvider>
  );
}

export default App;
