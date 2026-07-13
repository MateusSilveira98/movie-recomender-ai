import MovieFilterIcon from '@mui/icons-material/MovieFilter';
import { Box, Container, LinearProgress, Stack, Step, StepLabel, Stepper, Typography } from '@mui/material';
import { useRecommendationFlow } from '../data-access/hooks/use-recommendation-flow.hook';
import { STEPS } from '../entities/consts/steps.const';
import { FeedbackStep } from '../smart-components/feedback-step/feedback-step.smartc';
import { IntroStep } from '../smart-components/intro-step/intro-step.smartc';
import { PreferencesStep } from '../smart-components/preferences-step/preferences-step.smartc';
import { RecommendationsStep } from '../smart-components/recommendations-step/recommendations-step.smartc';
import { WatchedStep } from '../smart-components/watched-step/watched-step.smartc';

export function RecommendationFlowContainer() {
  const flow = useRecommendationFlow();
  const activeStepIndex = STEPS.findIndex((step) => step.id === flow.activeStep);
  const stepsRendering = {
    intro: (
      <IntroStep
        hasStoredSession={flow.hasStoredSession}
        onAdvance={() => flow.setActiveStep('preferences')}
        onResume={() => flow.setActiveStep('recommendations')}
      />
    ),
    preferences: (
      <PreferencesStep
        preferences={flow.preferences}
        onBack={() => flow.setActiveStep('intro')}
        onContinue={() => flow.setActiveStep('watched')}
        onFreeTextChange={flow.updateFreeText}
        onGenreToggle={flow.updateGenres}
        onMoodToggle={flow.updateMoods}
        onRuntimeChange={flow.updateRuntime}
      />
    ),
    watched: (
      <WatchedStep
        history={flow.history}
        onBack={() => flow.setActiveStep('preferences')}
        onContinue={() => flow.setActiveStep('liked')}
        onWatchedToggle={flow.updateWatched}
      />
    ),
    liked: (
      <FeedbackStep
        history={flow.history}
        watchedMovies={flow.watchedMovies}
        onBack={() => flow.setActiveStep('watched')}
        onContinue={flow.completeRound}
        onOpinionChange={flow.setMovieOpinion}
      />
    ),
    recommendations: (
      <RecommendationsStep
        recommendations={flow.recommendations}
        rounds={flow.recommendationRounds}
        onStartNewRound={flow.startNewRound}
      />
    ),
  };

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
      <Container maxWidth="lg" sx={{ py: { xs: 3, md: 6 } }}>
        <Stack spacing={4}>
          <Box sx={{ alignItems: 'center', display: 'flex', gap: 1.5 }}>
            <MovieFilterIcon color="primary" fontSize="large" />
            <Box>
              <Typography variant="h4" component="h1">
                Movie Recommender AI
              </Typography>
              <Typography color="text.secondary">
                Um fluxo rapido pra transformar preferencias e historico em recomendacoes.
              </Typography>
            </Box>
          </Box>

          <Stepper activeStep={activeStepIndex} alternativeLabel sx={{ display: { xs: 'none', md: 'flex' } }}>
            {STEPS.map((step) => (
              <Step key={step.id}>
                <StepLabel>{step.label}</StepLabel>
              </Step>
            ))}
          </Stepper>
          <LinearProgress
            variant="determinate"
            value={(activeStepIndex / (STEPS.length - 1)) * 100}
            sx={{ display: { md: 'none' } }}
          />

          {stepsRendering[flow.activeStep]}
        </Stack>
      </Container>
    </Box>
  );
}
