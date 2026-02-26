import React from 'react';
import { Routes, Route } from 'react-router-dom';
import { ThemeProvider } from './contexts/ThemeContext';
import { AssessmentProvider } from './contexts/AssessmentContext';
import { ToastProvider } from './components/ui/Toast';

// Pages
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import AssessmentHistory from './pages/AssessmentHistory';
import HistoryReportView from './pages/HistoryReportView';
import NotFound from './pages/NotFound';

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
          <Routes>
            <Route path="/" element={<Login />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/assessment/grip" element={<GripAssessment />} />
            <Route path="/assessment/sitstand" element={<SitStandAssessment />} />
            <Route path="/assessment/standing" element={<StandingAssessment />} />
            <Route path="/assessment/gait" element={<GaitAssessment />} />
            <Route path="/history" element={<AssessmentHistory />} />
            <Route path="/history/report" element={<HistoryReportView />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </ToastProvider>
      </AssessmentProvider>
    </ThemeProvider>
  );
}

export default App;
