import { CoffeeIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

const REPOSITORY = 'https://github.com/robertsamples/meltcalc';
const COFFEE = 'https://buymeacoffee.com/rsamples';

function Link({ href, children }: { href: string; children: ReactNode }) {
	return (
		<a
			href={href}
			target="_blank"
			rel="noopener noreferrer"
			className="underline underline-offset-2 transition-colors hover:text-foreground focus:text-foreground"
		>
			{children}
		</a>
	);
}

/** The GitHub mark, as used on the sibling stepper-simulator page */
function GitHubMark() {
	return (
		<svg role="img" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="currentColor">
			<title>GitHub</title>
			<path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
		</svg>
	);
}

/**
 * Where the numbers came from, how to add to them, and what else is worth having open.
 *
 * Deliberately modest about sourcing: the databases are compiled by hand and the material
 * properties are textbook values, so the honest thing is to say so rather than imply a citation
 * behind every figure.
 */
export function AttributionCard({ className }: { className?: string }) {
	return (
		<>
			<Card className={cn(className)}>
				<CardHeader>
					<CardTitle className="text-base">Attribution</CardTitle>
				</CardHeader>
				<CardContent className="text-xs text-muted-foreground leading-relaxed">
					<ul className="list-disc list-inside space-y-1">
						<li>
							<Link href="https://github.com/robertsamples">Robert Samples</Link> for the hotend
							database and the material properties behind every chart
						</li>
						<li>
							<Link href="https://github.com/TheDevMinerTV/stepper-simulator">stepper-simulator</Link>{' '}
							by <Link href="https://github.com/TheDevMinerTV">TheDevMinerTV</Link>, whose structure
							this app is built on
						</li>
						<li>
							Material properties are typical published values for each polymer, not brand data. The
							melt zone model is approximated from first principles and reference observations — see <em>How this works</em>
						</li>
					</ul>
				</CardContent>
			</Card>

			<Card className={cn(className)}>
				<CardHeader>
					<CardTitle className="text-base">Other useful tools</CardTitle>
				</CardHeader>
				<CardContent className="text-xs text-muted-foreground leading-relaxed">
					<ul className="list-disc list-inside space-y-1">
						<li>
							<Link href="https://stepper-sim.devminer.xyz/">Stepper simulator</Link> — torque and
							speed for a given motor and driver
						</li>
						<li>
							<Link href="https://www.lukeslabonline.com/pages/belt-tension-calculator">
								Luke's Lab belt tension calculator
							</Link>{' '}
							— frequency to tension for a given belt and span
						</li>
						<li>
							<Link href="https://flowcalc.net/">Luke's Lab flow rate calculator</Link> — measured
							flow from an extrusion test
						</li>
						<li>
							<Link href="https://blog.prusa3d.com/calculator_3416/">Prusa RepRap calculator</Link> —
							steps per mm, belts, leadscrews and more
						</li>
					</ul>
				</CardContent>
			</Card>

			<Card className={cn(className)}>
				<CardHeader>
					<CardTitle className="text-base">Contribute</CardTitle>
				</CardHeader>
				<CardContent className="flex flex-col gap-3 text-xs text-muted-foreground leading-relaxed">
					<p>
						The model and the figures on this page are{' '}
						<Link href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</Link> — use them
						anywhere, commercially or not, with a link back. The site code is MIT.
					</p>

					<p>
						Missing a hotend, or know a price or melt zone length that is wrong? Both databases are
						plain CSV in <code>data/</code> — corrections and additions by Pull Request are very
						welcome.
					</p>

					<div className="flex flex-row gap-2">
						<Button className="flex-1" variant="outline" asChild>
							<a href={REPOSITORY} target="_blank" rel="noopener noreferrer">
								<GitHubMark />
								Repository
							</a>
						</Button>
						<Button className="flex-1" variant="outline" asChild>
							<a href={COFFEE} target="_blank" rel="noopener noreferrer">
								<CoffeeIcon />
								Buy me a coffee
							</a>
						</Button>
					</div>
				</CardContent>
			</Card>
		</>
	);
}
