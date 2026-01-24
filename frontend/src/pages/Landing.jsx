import { Link } from 'react-router-dom'
import { MessageSquare, Zap, Shield, DollarSign, CheckCircle, ArrowRight } from 'lucide-react'

export default function Landing() {
  return (
    <div className="min-h-screen bg-white">
      {/* Navigation */}
      <nav className="bg-white border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center gap-2">
              <MessageSquare className="text-primary-500" size={32} />
              <span className="text-xl font-bold text-gray-900">WhatsApp Connector</span>
            </div>
            <div className="flex items-center gap-4">
              <Link to="/login" className="text-gray-600 hover:text-gray-900 font-medium">
                Login
              </Link>
              <Link
                to="/register"
                className="bg-primary-500 text-white px-4 py-2 rounded-lg hover:bg-primary-600 transition-colors font-medium"
              >
                Get Started
              </Link>
            </div>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="py-20 bg-gradient-to-b from-primary-50 to-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h1 className="text-4xl md:text-6xl font-bold text-gray-900 mb-6">
            Connect WhatsApp to
            <span className="text-primary-500"> GoHighLevel</span>
          </h1>
          <p className="text-xl text-gray-600 mb-8 max-w-3xl mx-auto">
            Send and receive WhatsApp messages directly from your GHL account.
            Replace expensive SMS with free WhatsApp messaging. Simple setup, powerful results.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              to="/register"
              className="inline-flex items-center justify-center gap-2 bg-primary-500 text-white px-8 py-4 rounded-lg hover:bg-primary-600 transition-colors font-medium text-lg"
            >
              Start Free Trial
              <ArrowRight size={20} />
            </Link>
            <a
              href="#pricing"
              className="inline-flex items-center justify-center gap-2 border border-gray-300 text-gray-700 px-8 py-4 rounded-lg hover:bg-gray-50 transition-colors font-medium text-lg"
            >
              View Pricing
            </a>
          </div>
          <p className="mt-4 text-sm text-gray-500">No credit card required</p>
        </div>
      </section>

      {/* Features Section */}
      <section className="py-20" id="features">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">
              Everything you need to connect WhatsApp
            </h2>
            <p className="text-xl text-gray-600 max-w-2xl mx-auto">
              Simple integration that works with your existing GoHighLevel setup
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-8">
            <div className="bg-white p-8 rounded-xl border border-gray-200 hover:shadow-lg transition-shadow">
              <div className="bg-primary-100 w-14 h-14 rounded-lg flex items-center justify-center mb-6">
                <Zap className="text-primary-500" size={28} />
              </div>
              <h3 className="text-xl font-semibold text-gray-900 mb-3">Easy Setup</h3>
              <p className="text-gray-600">
                Connect your WhatsApp in minutes. Just scan a QR code and you're ready to go.
                No technical knowledge required.
              </p>
            </div>

            <div className="bg-white p-8 rounded-xl border border-gray-200 hover:shadow-lg transition-shadow">
              <div className="bg-green-100 w-14 h-14 rounded-lg flex items-center justify-center mb-6">
                <DollarSign className="text-green-500" size={28} />
              </div>
              <h3 className="text-xl font-semibold text-gray-900 mb-3">Save Money</h3>
              <p className="text-gray-600">
                Stop paying per message. Replace GHL's expensive SMS with free WhatsApp messaging.
                Fixed monthly price, unlimited messages.
              </p>
            </div>

            <div className="bg-white p-8 rounded-xl border border-gray-200 hover:shadow-lg transition-shadow">
              <div className="bg-blue-100 w-14 h-14 rounded-lg flex items-center justify-center mb-6">
                <Shield className="text-blue-500" size={28} />
              </div>
              <h3 className="text-xl font-semibold text-gray-900 mb-3">Reliable & Secure</h3>
              <p className="text-gray-600">
                Your messages are delivered instantly. Secure connection with end-to-end encryption.
                99.9% uptime guarantee.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="py-20 bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">
              How It Works
            </h2>
            <p className="text-xl text-gray-600">
              Three simple steps to get started
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-8">
            <div className="text-center">
              <div className="bg-primary-500 text-white w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-6 text-xl font-bold">
                1
              </div>
              <h3 className="text-xl font-semibold text-gray-900 mb-3">Create Account</h3>
              <p className="text-gray-600">
                Sign up and create your sub-account with your GHL location ID
              </p>
            </div>

            <div className="text-center">
              <div className="bg-primary-500 text-white w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-6 text-xl font-bold">
                2
              </div>
              <h3 className="text-xl font-semibold text-gray-900 mb-3">Scan QR Code</h3>
              <p className="text-gray-600">
                Open WhatsApp on your phone and scan the QR code to connect
              </p>
            </div>

            <div className="text-center">
              <div className="bg-primary-500 text-white w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-6 text-xl font-bold">
                3
              </div>
              <h3 className="text-xl font-semibold text-gray-900 mb-3">Start Messaging</h3>
              <p className="text-gray-600">
                Send WhatsApp messages from GHL using the SMS feature - it's that simple!
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Pricing Section */}
      <section className="py-20" id="pricing">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">
              Simple, Transparent Pricing
            </h2>
            <p className="text-xl text-gray-600">
              Pay per location. Volume discounts available.
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-8 max-w-4xl mx-auto">
            {/* Standard Plan */}
            <div className="bg-white rounded-2xl border-2 border-gray-200 shadow-lg overflow-hidden">
              <div className="p-8">
                <h3 className="text-2xl font-bold text-gray-900 mb-2">Standard</h3>
                <p className="text-gray-600 mb-6">For agencies with 1-10 locations</p>

                <div className="flex items-baseline mb-8">
                  <span className="text-5xl font-bold text-gray-900">$29</span>
                  <span className="text-gray-600 ml-2">/month per location</span>
                </div>

                <ul className="space-y-4 mb-8">
                  <li className="flex items-center gap-3">
                    <CheckCircle className="text-green-500 flex-shrink-0" size={20} />
                    <span className="text-gray-700">Unlimited WhatsApp messages</span>
                  </li>
                  <li className="flex items-center gap-3">
                    <CheckCircle className="text-green-500 flex-shrink-0" size={20} />
                    <span className="text-gray-700">GHL integration</span>
                  </li>
                  <li className="flex items-center gap-3">
                    <CheckCircle className="text-green-500 flex-shrink-0" size={20} />
                    <span className="text-gray-700">Up to 10 locations</span>
                  </li>
                  <li className="flex items-center gap-3">
                    <CheckCircle className="text-green-500 flex-shrink-0" size={20} />
                    <span className="text-gray-700">QR code connection</span>
                  </li>
                  <li className="flex items-center gap-3">
                    <CheckCircle className="text-green-500 flex-shrink-0" size={20} />
                    <span className="text-gray-700">Email support</span>
                  </li>
                </ul>

                <Link
                  to="/register"
                  className="block w-full text-center border-2 border-primary-500 text-primary-500 py-4 rounded-lg hover:bg-primary-50 transition-colors font-medium text-lg"
                >
                  Get Started
                </Link>
              </div>
            </div>

            {/* Volume Plan */}
            <div className="bg-white rounded-2xl border-2 border-primary-500 shadow-xl overflow-hidden">
              <div className="bg-primary-500 text-white text-center py-2 text-sm font-medium">
                BEST VALUE
              </div>
              <div className="p-8">
                <h3 className="text-2xl font-bold text-gray-900 mb-2">Volume</h3>
                <p className="text-gray-600 mb-6">For agencies with 10+ locations</p>

                <div className="flex items-baseline mb-8">
                  <span className="text-5xl font-bold text-gray-900">$19</span>
                  <span className="text-gray-600 ml-2">/month per location</span>
                </div>

                <ul className="space-y-4 mb-8">
                  <li className="flex items-center gap-3">
                    <CheckCircle className="text-green-500 flex-shrink-0" size={20} />
                    <span className="text-gray-700">Unlimited WhatsApp messages</span>
                  </li>
                  <li className="flex items-center gap-3">
                    <CheckCircle className="text-green-500 flex-shrink-0" size={20} />
                    <span className="text-gray-700">GHL integration</span>
                  </li>
                  <li className="flex items-center gap-3">
                    <CheckCircle className="text-green-500 flex-shrink-0" size={20} />
                    <span className="text-gray-700">Unlimited locations</span>
                  </li>
                  <li className="flex items-center gap-3">
                    <CheckCircle className="text-green-500 flex-shrink-0" size={20} />
                    <span className="text-gray-700">QR code connection</span>
                  </li>
                  <li className="flex items-center gap-3">
                    <CheckCircle className="text-green-500 flex-shrink-0" size={20} />
                    <span className="text-gray-700">Priority support</span>
                  </li>
                  <li className="flex items-center gap-3">
                    <CheckCircle className="text-green-500 flex-shrink-0" size={20} />
                    <span className="text-gray-700">Save $10/location</span>
                  </li>
                </ul>

                <Link
                  to="/register"
                  className="block w-full text-center bg-primary-500 text-white py-4 rounded-lg hover:bg-primary-600 transition-colors font-medium text-lg"
                >
                  Get Started
                </Link>
                <p className="text-center text-sm text-gray-500 mt-4">
                  7-day free trial included
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20 bg-primary-500">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-3xl md:text-4xl font-bold text-white mb-6">
            Ready to save on messaging costs?
          </h2>
          <p className="text-xl text-primary-100 mb-8 max-w-2xl mx-auto">
            Join hundreds of agencies already using WhatsApp Connector to communicate with their clients.
          </p>
          <Link
            to="/register"
            className="inline-flex items-center gap-2 bg-white text-primary-500 px-8 py-4 rounded-lg hover:bg-gray-100 transition-colors font-medium text-lg"
          >
            Start Your Free Trial
            <ArrowRight size={20} />
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-gray-900 text-gray-400 py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col md:flex-row justify-between items-center">
            <div className="flex items-center gap-2 mb-4 md:mb-0">
              <MessageSquare className="text-primary-500" size={24} />
              <span className="text-white font-semibold">WhatsApp Connector</span>
            </div>
            <div className="flex gap-8">
              <a href="#features" className="hover:text-white transition-colors">Features</a>
              <a href="#pricing" className="hover:text-white transition-colors">Pricing</a>
              <Link to="/login" className="hover:text-white transition-colors">Login</Link>
            </div>
          </div>
          <div className="border-t border-gray-800 mt-8 pt-8 text-center text-sm">
            <p>&copy; {new Date().getFullYear()} WhatsApp Connector. All rights reserved.</p>
          </div>
        </div>
      </footer>
    </div>
  )
}
